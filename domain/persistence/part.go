package persistence

import "time"

type Part struct {
	ID        int64     `json:"id" db:"id"`
	ContentID int64     `json:"content_id" db:"content_id"`
	Text      string    `json:"text" db:"text"`
	CreateAt  time.Time `json:"create_at" db:"create_at"`
}
