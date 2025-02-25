package test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
)

func TestGeminiSearch(t *testing.T) {
	apiKey := "AIzaSyAbYS0Ez49A88wpVA9q599iO_gCYsKs_MI"

	requestBody := []byte(`{"contents":
          [{"parts": [{"text": "What is the current Google stock price?"}]}],
      "tools": [{"google_search_retrieval": {
                  "dynamic_retrieval_config": {
                    "mode": "MODE_DYNAMIC",
                    "dynamic_threshold": 1,
                }
            }
        }
    ]
}`)

	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=%s", apiKey)

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(requestBody))
	if err != nil {
		t.Fatalf("Error creating HTTP request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("Error executing HTTP request: %v", err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("Error reading response body: %v", err)
	}

	var response map[string]interface{} // 使用 map[string]interface{}
	err = json.Unmarshal(responseBody, &response)
	if err != nil {
		t.Fatalf("Error unmarshalling JSON: %v", err)
	}

	responseJSON, err := json.MarshalIndent(response, "", "  ") // 格式化JSON
	if err != nil {
		t.Fatalf("Error marshaling response to JSON: %v", err)
	}

	fmt.Println(string(responseJSON))

}
