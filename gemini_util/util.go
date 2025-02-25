package gemini_util

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"github.com/wangArtsoar/gemini-ai/configuration"
)

type IUtil interface {
	Encrypt() (string, error)
	Decrypt(sessionBase string) (string, error)
}

type Util struct{}

// Encrypt AES 加密并转换为 Base64 编码
func (u Util) Encrypt() (string, error) {
	envMap := configuration.EnvMap
	key := []byte(envMap["KEY"]) // AES 密钥
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	//plaintext := []byte(fileName)
	paddedPlaintext := pkcs7Pad([]byte("Artsoar Wang"), aes.BlockSize)

	ciphertext := make([]byte, aes.BlockSize+len(paddedPlaintext))
	iv := ciphertext[:aes.BlockSize]
	if _, err = rand.Read(iv); err != nil {
		return "", err
	}

	mode := cipher.NewCBCEncrypter(block, iv)
	mode.CryptBlocks(ciphertext[aes.BlockSize:], paddedPlaintext)

	// 使用 URL 安全的 Base64 编码
	return base64.RawURLEncoding.EncodeToString(ciphertext), nil
}

// PKCS7 填充函数
func pkcs7Pad(input []byte, blockSize int) []byte {
	paddingLen := blockSize - len(input)%blockSize
	padding := bytes.Repeat([]byte{byte(paddingLen)}, paddingLen)
	return append(input, padding...)
}

// Decrypt AES 解密并从 Base64 编码恢复原始文件名
func (u Util) Decrypt(encrypted string) (string, error) {
	envMap := configuration.EnvMap
	key := []byte(envMap["KEY"]) // AES 密钥
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	// 使用 URL 安全的 Base64 解码
	ciphertext, err := base64.RawURLEncoding.DecodeString(encrypted)
	if err != nil {
		return "", err
	}

	if len(ciphertext) < aes.BlockSize {
		return "", errors.New("ciphertext too short")
	}
	iv := ciphertext[:aes.BlockSize]
	ciphertext = ciphertext[aes.BlockSize:]

	mode := cipher.NewCBCDecrypter(block, iv)
	mode.CryptBlocks(ciphertext, ciphertext)

	plaintext := pkcs7Unpad(ciphertext, aes.BlockSize)

	return string(plaintext), nil
}

// PKCS7 去填充函数
func pkcs7Unpad(input []byte, blockSize int) []byte {
	paddingLen := int(input[len(input)-1])
	if paddingLen > blockSize {
		return nil
	}
	return input[:len(input)-paddingLen]
}
