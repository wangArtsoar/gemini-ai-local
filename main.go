package main

/*
#cgo CFLAGS: -I sqlite-amalgamation-3490100
#cgo LDFLAGS: -L sqlite-amalgamation-3490100 -lsqlite3
#include <sqlite3.h>
*/
import "C"

import (
	"embed"
	"fmt"
	"github.com/Dreamacro/clash/config"
	"github.com/Dreamacro/clash/hub/executor"
	"github.com/Dreamacro/clash/hub/route"
	clog "github.com/Dreamacro/clash/log"
	"github.com/getlantern/systray"
	"github.com/joho/godotenv"
	"github.com/lxn/walk"
	_ "github.com/mattn/go-sqlite3"
	"github.com/skratchdot/open-golang/open"
	"github.com/wangArtsoar/gemini-ai/configuration"
	"github.com/wangArtsoar/gemini-ai/router"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"
)

//go:embed templates/*.* templates/static/.env templates/static/config.yaml templates/static/favicon.ico sqlite-amalgamation-3490100/* favicon.ico templates/sdk/*
var fs embed.FS

// 全局变量，存储选中的项目简介
var selectedDescription = fmt.Sprintln(fmt.Sprint(`使用的AI : Google Gemini
作者 : xiaoyi
编程语言 : Go、JS

本程序仅作为学习探讨
	`))

func init() {
	// Show initialization dialog
	go func() {
		walk.MsgBox(nil, "初始化", "初始化中，请等待...", walk.MsgBoxIconInformation)
	}()

	var initErr error
	defer func() {
		if initErr != nil {
			walk.MsgBox(nil, "错误", "初始化失败："+initErr.Error(),
				walk.MsgBoxIconError|walk.MsgBoxOK)
			os.Exit(1)
		}
	}()

	readFile, err := fs.ReadFile("templates/static/.env")
	if err != nil {
		initErr = fmt.Errorf("读取环境变量文件失败: %w", err)
		return
	}

	configuration.EnvMap, err = godotenv.UnmarshalBytes(readFile)
	if err != nil {
		initErr = fmt.Errorf("解析环境变量失败: %w", err)
		return
	}

	fmt.Println("环境变量加载完成")

	fileBytes, err := fs.ReadFile(configuration.EnvMap["CONFIG_DIR"])
	if err != nil {
		initErr = fmt.Errorf("读取配置文件失败: %w", err)
		return
	}

	clog.SetLevel(clog.SILENT)
	cfg, err := config.Parse(fileBytes)
	if err != nil {
		initErr = fmt.Errorf("解析配置文件失败: %w", err)
		return
	}

	cfg.General.ExternalController = configuration.EnvMap["EXT_CTRL"]
	cfg.General.LogLevel = clog.SILENT
	if cfg.General.ExternalUI != "" {
		route.SetUIPath(cfg.General.ExternalUI)
	}

	go route.Start(cfg.General.ExternalController, cfg.General.Secret)
	executor.ApplyConfig(cfg, true)

	proxyURL, err := url.Parse(configuration.EnvMap["PROXY_URI"])
	if err != nil {
		initErr = fmt.Errorf("解析代理URL失败: %w", err)
		return
	}

	transport := &http.Transport{
		Proxy: http.ProxyURL(proxyURL),
	}

	configuration.HttpClientWithPort = &http.Client{
		Transport: transport,
	}

	fmt.Println("配置文件加载完成")

	if err = configuration.InitHistoryDir(); err != nil {
		initErr = fmt.Errorf("初始化历史目录失败: %w", err)
		return
	}

	configuration.Fs = &fs
	configuration.AIApi = configuration.BuildAIApi("", "")

	if err = configuration.InitializeDBPool(configuration.DbPath); err != nil {
		initErr = fmt.Errorf("初始化数据库连接池失败: %w", err)
		return
	}

	if err = configuration.VerifyGoogleAccess(); err != nil {
		initErr = fmt.Errorf("验证Google访问失败: %w", err)
		return
	}

	// Close the initialization dialog by showing a success message
	walk.MsgBox(nil, "初始化完成", "程序初始化成功！",
		walk.MsgBoxIconInformation|walk.MsgBoxOK)
}

// 添加端口检查函数
func isPortAvailable(port string) bool {
	ln, err := net.Listen("tcp", ":"+port)
	if err != nil {
		return false
	}
	ln.Close()
	return true
}

func main() {
	// 启动系统托盘
	systray.Run(onReady, onExit)
}

// 显示项目简介的函数 (使用 walk 库创建对话框)
func showProjectDescription() {
	if walk.MsgBox(nil, "项目简介",
		selectedDescription,
		walk.MsgBoxOK|walk.MsgBoxIconInformation) != walk.DlgCmdOK {
		return
	}
}

func onReady() {
	iconBytes, err := fs.ReadFile("templates/static/favicon.ico")
	if err != nil {
		log.Fatal(err)
	}

	systray.SetIcon(iconBytes)
	systray.SetTitle("Gemini AI")
	systray.SetTooltip("Gemini AI Assistant")

	// 添加菜单项
	mOpen := systray.AddMenuItem("打开界面", "打开Web界面")
	// 添加 "项目简介" 菜单项
	mDescription := systray.AddMenuItem("项目简介", "显示项目简介")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("退出", "关闭应用")

	// 启动 Web 服务器
	r := router.Register()
	port := "8000"
	for !isPortAvailable(port) {
		portNum, _ := strconv.Atoi(port)
		port = strconv.Itoa(portNum + 1)
	}

	api := fmt.Sprintf("http://localhost:%s/index", port)

	// 启动 HTTP 服务器
	server := &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	// 自动打开浏览器
	time.Sleep(500 * time.Millisecond)
	fmt.Printf("Server is running at %s\n", api)
	_ = open.Run(api)

	// 处理菜单事件
	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				_ = open.Run(api)
			case <-mDescription.ClickedCh:
				// 点击 "项目简介" 菜单项时，显示简介
				showProjectDescription()
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func onExit() {
	// 优雅退出
	os.Exit(0)
}
