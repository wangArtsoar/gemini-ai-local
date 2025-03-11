package domain

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/wangArtsoar/gemini-ai/configuration"
	"github.com/wangArtsoar/gemini-ai/domain/persistence"
	"github.com/wangArtsoar/gemini-ai/gemini_util"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxRetries = 3
const retryDelay = time.Millisecond * 500

type History struct {
	SessionID       int         `json:"session_id"`
	Title           string      `json:"title"`
	SessionBase     string      `json:"session_base"`
	LastMessageTime interface{} `json:"last_message_time"`
}

// FindAllTitle 查询所有会话标题
func FindAllTitle() ([]*History, error) {
	sqlStmt := `
		SELECT s.id,s.title,s.session_base,max(p.create_at) AS last_message_time
		FROM session s
				 JOIN content c ON s.id = c.session_id
				 JOIN part p ON c.id = p.content_id
		GROUP BY s.id
		ORDER BY last_message_time DESC;`

	rows, err := configuration.DB.Query(sqlStmt)
	if err != nil {
		return nil, err
	}

	defer rows.Close()
	var titles []*History
	for rows.Next() {
		var res History
		if err = rows.Scan(&res.SessionID, &res.Title, &res.SessionBase, &res.LastMessageTime); err != nil {
			return nil, err
		}
		titles = append(titles, &res)
	}

	// 检查 rows 是否遇到错误
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return titles, nil
}

func FindLastSessionID(db *sql.DB) (int64, error) {
	// SQL 查询语句，按 id 降序排列，仅获取第一条记录
	sqlQuery := `
		SELECT id 
		FROM session 
		ORDER BY id DESC 
		LIMIT 1
	`

	var lastID int64

	// 执行查询并扫描结果
	err := db.QueryRow(sqlQuery).Scan(&lastID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// 如果没有找到任何记录
			return 0, nil
		}
		// 其他 SQL 错误
		return 0, fmt.Errorf("failed to query last session id: %w", err)
	}

	// 返回最后的会话 ID 和 nil 错误
	return lastID, nil
}

func FindSessionByID(db *sql.DB, id int64) (*persistence.Session, error) {
	sqlStmt := `SELECT id, title, session_base, create_at From session where id = ?`
	var session persistence.Session

	err := db.QueryRow(sqlStmt, id).Scan(
		&session.ID,
		&session.Title,
		&session.SessionBase,
		&session.CreateAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// 如果没有找到任何记录
			return nil, sql.ErrNoRows
		}
		// 其他 SQL 错误
		return nil, fmt.Errorf("failed to query session by id: %w", err)
	}

	return &session, nil
}

type Title struct {
	SessionID int64  `json:"session_id"`
	Text      string `json:"text"`
}

func GetSessionTitle(input configuration.UserInput) (*Title, error) {
	db := configuration.DB
	session, err := FindSessionByID(db, int64(input.SessionID))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to find session: %w", err)
	}

	if session.Title != "" {
		return nil, nil
	}

	title := &Title{SessionID: session.ID}
	runes := []rune(input.Message)

	// 根据消息长度决定标题
	if len(runes) < 14 {
		title.Text = input.Message
	} else {
		// 请求AI生成标题
		input.Message = input.Message + "\n，请根据这段文字帮我起一个标题，不超过26个字符，直接给出一个，不要添加任何信息，后面不要加换行"
		resp, err := PostRequestOnClient(input)
		if err != nil {
			return nil, fmt.Errorf("failed to get title from AI: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("unexpected HTTP status: %d", resp.StatusCode)
		}

		if resp.Body == nil {
			return nil, fmt.Errorf("response body is empty")
		}

		var geminiResponse GeminiResponse
		if err := json.NewDecoder(resp.Body).Decode(&geminiResponse); err != nil {
			return nil, fmt.Errorf("error decoding JSON response: %w", err)
		}

		// 获取生成的标题文本
		for _, candidate := range geminiResponse.Candidates {
			for _, part := range candidate.Content.Parts {
				title.Text = part.Text
				break // 只取第一个部分的文本
			}
			break // 只取第一个候选项
		}
	}

	// 更新数据库中的标题
	sqlStmt := `UPDATE session SET title = ? WHERE id = ?`
	if _, err := db.Exec(sqlStmt, title.Text, session.ID); err != nil {
		return nil, fmt.Errorf("failed to update session title: %w", err)
	}

	return title, nil
}

// Chat 对话
func Chat(input configuration.UserInput, db *sql.DB, w http.ResponseWriter) error {
	session, err := FindSessionByID(db, int64(input.SessionID))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// No session found
		} else {
			return fmt.Errorf("failed to find session: %w", err)
		}
	}

	ctx := context.Background()

	err = retryTransaction(db, ctx, func(tx *sql.Tx) error {
		var requestBody RequestBody
		var sessionLastId = int64(input.SessionID)

		if session != nil {
			if input.IsReply && input.ContentID != nil {
				// 查询 content ID 比 ContentID 大的记录并删除
				if err = delHistoryInContentIDBySessionID(db, int64(input.SessionID), int64(*input.ContentID)); err != nil {
					return fmt.Errorf("failed to delete history: %w", err)
				}
			}
			history, err := FindHistoryBySessionID(db, int64(input.SessionID), false)
			if err != nil {
				return fmt.Errorf("failed to get history: %w", err)
			}
			if history != nil {
				requestBody = *history
			}
		}
		sessionLastId, err = saveSession(ctx, tx, session)
		if err != nil {
			return err
		}

		body, err := requestBody.prepareRequestBody(input)
		if err != nil {
			return err
		}

		if err = saveHistory(ctx, tx, sessionLastId, "user", input); err != nil {
			log.Printf("保存用户历史记录失败: %v", err)
			return err
		}

		defer func() {
			if saveErr := saveHistory(ctx, tx, sessionLastId, "model", Result.String()); saveErr != nil {
				log.Printf("保存模型历史记录失败: %v", saveErr)
				if err == nil {
					err = saveErr
				}
			}
		}()

		// 发送请求并处理响应
		resp, err := requestBody.sendRequest(body)
		if err != nil {
			return err
		}

		defer resp.Body.Close()
		// 判断响应的 Content-Type 并处理
		contentType := resp.Header.Get("Content-Type")
		if strings.HasPrefix(contentType, "text/event-stream") {
			return requestBody.handleSSEResponse(w, resp)
		} else if strings.HasPrefix(contentType, "application/json") {
			return requestBody.handleJSONResponse(w, resp)
		} else {
			return fmt.Errorf("unexpected Content-Type: %v", contentType)
		}
	})
	return err
}

func delHistoryInContentIDBySessionID(db *sql.DB, sessionID int64, contentID int64) error {
	// First delete from part table
	sqlDeletePart := `DELETE FROM part WHERE content_id IN (
        SELECT c.id
        FROM content c
        WHERE c.session_id = ? AND c.id >= ?
    )`
	if _, err := db.Exec(sqlDeletePart, sessionID, contentID); err != nil {
		return fmt.Errorf("failed to delete parts: %w", err)
	}

	// Then delete from content table
	sqlDeleteContent := `DELETE FROM content WHERE session_id = ? AND id >= ?`
	if _, err := db.Exec(sqlDeleteContent, sessionID, contentID); err != nil {
		return fmt.Errorf("failed to delete content: %w", err)
	}

	return nil
}

func retryTransaction(db *sql.DB, ctx context.Context, txFunc func(tx *sql.Tx) error) error {
	var err error
	for i := 0; i < maxRetries; i++ {
		tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
		if err != nil {
			return fmt.Errorf("beginning transaction: %w", err)
		}
		err = txFunc(tx)
		if err == nil {
			if err := tx.Commit(); err != nil {
				return fmt.Errorf("committing transaction: %w", err)
			}
			return nil
		}

		if err.Error() == "database is locked" {
			log.Printf("transaction locked, retrying (%d/%d)...", i+1, maxRetries)
			tx.Rollback()          // 回滚事务
			time.Sleep(retryDelay) // 等待一会儿再重试
			continue
		}

		tx.Rollback() // 出现其他错误时回滚事务
		return fmt.Errorf("transaction failed: %w", err)
	}
	return fmt.Errorf("failed to complete transaction after %d retries: %w", maxRetries, err)
}

func saveSession(ctx context.Context, tx *sql.Tx, session *persistence.Session) (int64, error) {
	sessionBase, err := new(gemini_util.Util).Encrypt()
	if err != nil {
		return 0, err
	}

	if session != nil {
		_, err = tx.ExecContext(ctx, `UPDATE session SET session_base=?, update_at=? WHERE id= ?`,
			sessionBase, time.Now(), session.ID)
		if err != nil {
			return 0, err
		}
		return session.ID, nil
	} else {
		sessionResult, err := tx.ExecContext(ctx, `INSERT INTO session(title,session_base, create_at,update_at) VALUES (?,?,?,?)`,
			"", sessionBase, time.Now(), time.Now())
		if err != nil {
			return 0, err
		}
		insertId, err := sessionResult.LastInsertId()
		if err != nil {
			return 0, err
		}
		return insertId, nil
	}
}

func PostRequestOnClient(input configuration.UserInput) (*http.Response, error) {
	body, err := new(RequestBody).prepareRequestBody(input)
	if err != nil {
		return nil, err
	}

	request, err := http.NewRequest("POST",
		configuration.BuildAIApi("gemini-1.5-flash", configuration.EnvMap["CONTENT_TYPE_JSON"]),
		bytes.NewBuffer(body))

	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")

	resp, err := configuration.CurrentClient.Do(request)
	if err != nil {
		return nil, err
	}

	return resp, nil
}

func saveHistory(ctx context.Context, tx *sql.Tx, sessionID int64, role string, input interface{}) error {
	var message string
	var files []configuration.InlineDataDto

	// Type assertion to handle both string and UserInput
	switch v := input.(type) {
	case string:
		message = v
	case configuration.UserInput:
		message = v.Message
		files = v.Files
	default:
		return fmt.Errorf("unsupported input type: %T", input)
	}

	// Insert content with role
	contentResult, err := tx.ExecContext(ctx, "INSERT INTO content (session_id, role) VALUES (?, ?)", sessionID, role)
	if err != nil {
		return fmt.Errorf("failed to insert content: %w", err)
	}

	contentID, err := contentResult.LastInsertId()
	if err != nil {
		return fmt.Errorf("failed to get content ID: %w", err)
	}

	// Insert part with text
	partResult, err := tx.ExecContext(ctx,
		"INSERT INTO part (content_id, text, create_at) VALUES (?, ?, ?)",
		contentID, message, time.Now())
	if err != nil {
		return fmt.Errorf("failed to insert part: %w", err)
	}

	// Handle file attachments if present
	if len(files) > 0 {
		partID, err := partResult.LastInsertId()
		if err != nil {
			return fmt.Errorf("failed to get part ID: %w", err)
		}

		// Prepare statement for multiple file inserts
		stmt, err := tx.PrepareContext(ctx,
			"INSERT INTO inline_data (part_id, media_type, data) VALUES (?, ?, ?)")
		if err != nil {
			return fmt.Errorf("failed to prepare statement: %w", err)
		}
		defer stmt.Close()

		for _, file := range files {
			if file.MimeType == "" {
				file.MimeType = "image/jpeg"
			}
			if _, err := stmt.ExecContext(ctx, partID, file.MimeType, file.Data); err != nil {
				return fmt.Errorf("failed to insert file data: %w", err)
			}
		}
	}

	_, err = tx.ExecContext(ctx, `UPDATE session SET update_at=? WHERE id= ?`, time.Now(), sessionID)
	if err != nil {
		return fmt.Errorf("failed to insert content: %w", err)
	}
	return nil
}

func FindHistoryBySessionID(db *sql.DB, sessionID int64, isNeedContentID bool) (*RequestBody, error) {
	sqlHistory := `
	SELECT s.id, c.id, c.role, p.id,p.text, id.data, id.media_type
	FROM session s 
	LEFT JOIN content c ON c.session_id = s.id
	LEFT JOIN part p ON c.id = p.content_id
	LEFT JOIN inline_data id ON p.id = id.part_id
	WHERE s.id = ?
	ORDER BY p.create_at 
`

	rows, err := db.Query(sqlHistory, sessionID)
	if err != nil {
		return nil, err
	}

	defer rows.Close()

	type result struct {
		SessionID  int64
		ContentID  sql.NullInt64
		Role       sql.NullString
		PartID     sql.NullInt64
		Text       sql.NullString
		InlineData []byte
		MediaType  sql.NullString
	}

	var results []result
	for rows.Next() {
		var res result
		err = rows.Scan(&res.SessionID, &res.ContentID, &res.Role, &res.PartID, &res.Text, &res.InlineData, &res.MediaType)
		if err != nil {
			return nil, err
		}
		results = append(results, res)
	}

	err = rows.Err() // Check for any errors encountered during iteration
	if err != nil {
		return nil, err
	}

	if len(results) == 0 {
		return nil, nil
	}

	var requestBody RequestBody
	contentMap := make(map[int64]*Content)
	partMap := make(map[int64]*Part)
	for _, res := range results {
		// 检查 Content 是否已存在
		if !res.ContentID.Valid {
			continue
		}
		content, ok := contentMap[res.ContentID.Int64]
		if !ok {
			// 如果不存在，则创建新的 Content
			if isNeedContentID {
				content = &Content{
					ContentID: &res.ContentID.Int64,
					Role:      res.Role.String, // Role 只需要设置一次
				}
			} else {
				content = &Content{
					Role: res.Role.String, // Role 只需要设置一次
				}
			}

			contentMap[res.ContentID.Int64] = content
		}
		part1, ok := partMap[res.PartID.Int64]
		if !ok {
			part1 = &Part{Text: res.Text.String}
			content.Parts = append(content.Parts, part1)
		}
		if res.InlineData != nil {
			part2 := &Part{}
			part2.InlineData = &InlineData{
				Data:     res.InlineData,
				MimeType: res.MediaType.String,
			}
			content.Parts = append([]*Part{part2}, content.Parts...)
		}

		// Update the content in the map
		contentMap[res.ContentID.Int64] = content
	}
	// Convert map to slice
	// Create a slice of content IDs for sorting
	contentIDs := make([]int64, 0, len(contentMap))
	for id := range contentMap {
		contentIDs = append(contentIDs, id)
	}

	// Sort the IDs in ascending order
	sort.Slice(contentIDs, func(i, j int) bool {
		return contentIDs[i] < contentIDs[j]
	})

	// Create the final contents slice in sorted order
	requestBody.Contents = make([]*Content, 0, len(contentMap))
	for _, id := range contentIDs {
		requestBody.Contents = append(requestBody.Contents, contentMap[id])
	}
	// 转换完成后，返回 requestBody
	return &requestBody, nil
}

// DelHistoryBySessionID 删除会话历史记录
func DelHistoryBySessionID(db *sql.DB, sessionID int64) error {
	if sessionID == 0 {
		return nil
	}

	// 开启事务
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback() // 遇到 panic 回滚事务
			panic(p)
		}
	}()

	// 查询 content ID
	sqlStms := `SELECT c.id FROM content c WHERE c.session_id = ?`
	rows, err := tx.Query(sqlStms, sessionID)
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("failed to query content IDs: %w", err)
	}
	defer func(rows *sql.Rows) {
		err = rows.Close()
		if err != nil {
			log.Printf("failed to close rows: %v", err)
		}
	}(rows)

	var contentIDs []int64
	for rows.Next() {
		var contentID int64
		if err = rows.Scan(&contentID); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("failed to scan content ID: %w", err)
		}
		contentIDs = append(contentIDs, contentID)
	}

	if len(contentIDs) == 0 {
		_ = tx.Rollback()
		return nil
	}

	// 构造占位符和参数
	placeholders := make([]string, len(contentIDs))
	args := make([]interface{}, len(contentIDs))
	for i, id := range contentIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	sqlDelPart := fmt.Sprintf(`
		DELETE FROM part WHERE content_id IN (%s)
	`, strings.Join(placeholders, ","))

	sqlDelContent := `DELETE FROM content WHERE session_id = ?`
	sqlDelSession := `DELETE FROM session WHERE id = ?`

	// 使用 channel 和 WaitGroup 处理并行任务
	errCh := make(chan error, 3)
	var wg sync.WaitGroup

	// 删除 part 表内容
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, err = tx.Exec(sqlDelPart, args...)
		if err != nil {
			errCh <- fmt.Errorf("failed to delete from part: %w", err)
		}
	}()

	// 删除 content 表内容
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, err = tx.Exec(sqlDelContent, sessionID)
		if err != nil {
			errCh <- fmt.Errorf("failed to delete from content: %w", err)
		}
	}()

	// 删除 session 表内容
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, err = tx.Exec(sqlDelSession, sessionID)
		if err != nil {
			errCh <- fmt.Errorf("failed to delete from session: %w", err)
		}
	}()

	// 等待所有协程完成
	wg.Wait()
	close(errCh)

	// 检查是否有错误
	for err = range errCh {
		if err != nil {
			_ = tx.Rollback()
			return err
		}
	}

	// 提交事务
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// EditHistoryTitle 修改会话标题
func EditHistoryTitle(db *sql.DB, sessionID int64, title string) error {
	if sessionID == 0 {
		return nil
	}
	sqlQuery := `
		select count(*) from session s where s.id = ?
	`
	row := db.QueryRow(sqlQuery, sessionID)
	var count int
	err := row.Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		return nil
	}

	sqlUpdate := `
		update session set title = ? where id = ?
	`

	_, err = db.Exec(sqlUpdate, title, sessionID)
	if err != nil {
		return err
	}
	return nil
}
