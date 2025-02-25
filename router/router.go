package router

import (
	"encoding/json"
	"github.com/wangArtsoar/gemini-ai/configuration"
	"github.com/wangArtsoar/gemini-ai/domain"
	"html/template"
	"log"
	"net/http"
	"strconv"
)

func Register() *http.ServeMux {
	r := http.NewServeMux()
	r.Handle("GET /", http.FileServer(http.FS(*configuration.Fs)))
	r.HandleFunc("GET /index", handleIndex)
	r.HandleFunc("POST /chat", handleChat)
	r.HandleFunc("GET /historyList", handleHistory)
	r.HandleFunc("PUT /findHistory/{id}", handleFindHistory)
	r.HandleFunc("GET /switchModel", handleSwitchModel)
	r.HandleFunc("POST /generateTitle", handleGenerateTitle)
	r.HandleFunc("GET /lastSessionID", handleLastSessionID)
	r.HandleFunc("DELETE /deleteHistory/{id}", handleDeleteHistory)
	r.HandleFunc("PUT /edit-history/{sessionId}", handleEditHistoryTitle)
	r.HandleFunc("PUT /lockSession/{id}", handleLockSession)
	r.HandleFunc("GET /sessionLimitedByID", handleSessionLimitedByID)
	return r
}

func handleSessionLimitedByID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.URL.Query().Get("id"))
	if err != nil {
		log.Println("Failed to parse ID:", err)
		http.Error(w, "Invalid ID parameter", http.StatusBadRequest)
		return
	}

	flag, err := domain.FindSessionLimitedByID(configuration.DB, int64(id))
	if err != nil {
		log.Println("Failed to find session:", err)
		http.Error(w, "Failed to find session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(flag); err != nil {
		log.Println("Failed to encode response:", err)
		http.Error(w, "Failed to generate response", http.StatusInternalServerError)
		return
	}
}

func handleLockSession(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		log.Println(err)
		http.Error(w, "Failed to parse request", http.StatusBadRequest)
		return
	}
	err = domain.LockSession(configuration.DB, int64(id))
	if err != nil {
		log.Println(err)
		http.Error(w, "Failed to parse request", http.StatusInternalServerError)
		return
	}
}

func handleEditHistoryTitle(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("sessionId"))
	if err != nil {
		log.Println(err)
		http.Error(w, "Failed to parse request", http.StatusBadRequest)
		return
	}

	type T struct {
		Title string `json:"title"`
	}
	var t T
	if err = json.NewDecoder(r.Body).Decode(&t); err != nil {
		log.Println(err)
		http.Error(w, "Failed to parse request", http.StatusBadRequest)
		return
	}
	err = domain.EditHistoryTitle(configuration.DB, int64(id), t.Title)
	if err != nil {
		log.Println(err)
		http.Error(w, "Failed to parse request", http.StatusInternalServerError)
		return
	}
}

func handleDeleteHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		log.Println(err)
		http.Error(w, "Failed to parse request", http.StatusBadRequest)
		return
	}
	err = domain.DelHistoryBySessionID(configuration.DB, int64(id))
	if err != nil {
		log.Println(err)
		http.Error(w, "Server error: "+err.Error(), http.StatusInternalServerError)
		return
	}
}

func handleLastSessionID(w http.ResponseWriter, r *http.Request) {
	id, err := domain.FindLastSessionID(configuration.DB)
	if err != nil {
		log.Println(err)
		http.Error(w, "Server error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Write([]byte(strconv.FormatInt(id, 10)))
}

func handleGenerateTitle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}
	var userInput configuration.UserInput
	if err := json.NewDecoder(r.Body).Decode(&userInput); err != nil {
		log.Println(err)
		http.Error(w, "Failed to parse request", http.StatusBadRequest)
		return
	}

	title, err := domain.GetSessionTitle(userInput)
	if err != nil {
		log.Println(err)
		http.Error(w, "Server error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	bytes, err := json.Marshal(&title)
	if err != nil {
		log.Println(err)
		http.Error(w, "Server error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Write(bytes)
}

func handleSwitchModel(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	model := values.Get("model")
	configuration.AIApi = configuration.BuildAIApi(model, "")
}

func handleFindHistory(w http.ResponseWriter, r *http.Request) {
	// PUT get id
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		log.Println(err)
		http.Error(w, "Failed to parse request", http.StatusBadRequest)
		return
	}
	body, err := domain.FindHistoryBySessionID(configuration.DB, int64(id))
	if err != nil {
		log.Println(err)
		http.Error(w, "Server error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	bytes, err := json.Marshal(&body)
	if err != nil {
		log.Println(err)
		http.Error(w, "Server error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Write(bytes)
}

func handleHistory(w http.ResponseWriter, r *http.Request) {
	titles, err := domain.FindAllTitle()
	if err != nil {
		log.Println(err)
		return
	}

	bytes, err := json.Marshal(titles)
	if err != nil {
		log.Println(err)
		return
	}
	w.Write(bytes)
}

func handleChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}
	var userInput configuration.UserInput
	if r.Body == nil {
		http.Error(w, "Request body is empty", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	if err := json.NewDecoder(r.Body).Decode(&userInput); err != nil {
		log.Printf("Failed to parse request body: %v\n", err)
		http.Error(w, "Invalid JSON format in request body", http.StatusBadRequest)
		return
	}

	if userInput.Message == "" {
		http.Error(w, "Message field is required", http.StatusBadRequest)
		return
	}

	if err := domain.Chat(userInput, configuration.DB, w); err != nil {
		log.Println(err)
		http.Error(w, "Server error: "+err.Error(), configuration.HttpState)
		return
	}
}

// handleIndex 处理首页请求
func handleIndex(w http.ResponseWriter, _ *http.Request) {
	tmpl, err := template.ParseFS(configuration.Fs, "templates/index.html")
	if err != nil {
		log.Println(err)
		return
	}
	data := struct {
		Title string
	}{
		Title: "AI Chat",
	}
	err = tmpl.Execute(w, data)
	if err != nil {
		return
	}
}
