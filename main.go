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
var selectedDescription string = fmt.Sprintln(fmt.Sprint(`使用的AI : Google Gemini
作者 : xiaoyi
编程语言 : Go、JS

本程序仅作为学习探讨
	`))

func init() {
	readFile, err := fs.ReadFile("templates/static/.env")
	if err != nil {
		panic(err)
	}
	configuration.EnvMap, err = godotenv.UnmarshalBytes(readFile)
	if err != nil {
		panic(err)
	}
	fmt.Println("环境变量加载完成")
	// 1. 加载配置文件
	fileBytes, err := fs.ReadFile(configuration.EnvMap["CONFIG_DIR"])
	if err != nil {
		panic(err)
	}
	clog.SetLevel(clog.SILENT)
	cfg, err := config.Parse(fileBytes)
	if err != nil {
		panic(err)
	}
	cfg.General.ExternalController = configuration.EnvMap["EXT_CTRL"]
	cfg.General.LogLevel = clog.SILENT
	if cfg.General.ExternalUI != "" {
		route.SetUIPath(cfg.General.ExternalUI)
	}

	go route.Start(cfg.General.ExternalController, cfg.General.Secret)

	executor.ApplyConfig(cfg, true)
	// 创建代理URL
	proxyURL, err := url.Parse(configuration.EnvMap["PROXY_URI"])
	if err != nil {
		panic(err)
	}

	transport := &http.Transport{
		Proxy: http.ProxyURL(proxyURL),
	}

	configuration.HttpClient = &http.Client{
		Transport: transport,
	}
	fmt.Println("配置文件加载完成")
	configuration.InitHistoryDir()
	configuration.Fs = &fs
	configuration.AIApi = configuration.BuildAIApi("", "")
	if err = configuration.InitializeDBPool(configuration.DbPath); err != nil {
		panic(err)
	}
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
