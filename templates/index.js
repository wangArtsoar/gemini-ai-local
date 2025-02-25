// 全局变量，用于存储 SSE 连接的 reader，以便在需要时取消
let sseReader = null;
// 标记是否自动滚动
let autoScroll = true;
// Theme Toggle Functionality
document.addEventListener("DOMContentLoaded", function () {
    const themeToggle = document.getElementById("theme-toggle");
    const body = document.body;

    // Function to set theme
    function setTheme(themeName) {
        localStorage.setItem('theme', themeName);
        body.className = themeName;
    }

    // Function to toggle theme
    function toggleTheme() {
        if (localStorage.getItem('theme') === 'dark-theme') {
            setTheme('light-theme');
        } else {
            setTheme('dark-theme');
        }
        updateThemeButton();
    }

    // Function to update theme button icon
    function updateThemeButton() {
        if (localStorage.getItem('theme') === 'dark-theme') {
            themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
        } else {
            themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
        }
    }

    // Initial theme setup
    if (localStorage.getItem('theme') === 'dark-theme') {
        setTheme('dark-theme');
    } else {
        setTheme('light-theme');
    }
    updateThemeButton();

    // Event listener for theme toggle button
    themeToggle.addEventListener('click', function () {
        toggleTheme();
    });
});

async function setSessionID() {
    try {
        const response = await fetch("/lastSessionID", {method: "GET"});
        if (!response.ok) {
            console.error(`last session id API error: ${response.status}`);
            return;
        }
        const id = await response.text();
        sessionStorage.setItem("sessionId", id);
    } catch (error) {
        console.error("Failed to fetch session ID:", error);
    }
}

let currentModel = "2.0"; // 默认模型

function changeModel() {
    const modelSelect = document.getElementById("model-select");
    const selectedModel = modelSelect.value;
    console.log("Selected model:", selectedModel);

    fetch("/switchModel?model=" + encodeURIComponent(selectedModel), {
        method: "GET",
    })
        .then(response => {
            if (!response.ok) {
                console.error("Failed to switch model:", response.status);
                // 回退到默认选项（列表的第一个）
                modelSelect.value = modelSelect.options[0].value;
                return;
            }
            console.log("Model switched successfully");
        })
        .catch(error => {
            console.error("Error switching model:", error);
            // 发生错误时，回退到第一个选项
            modelSelect.value = modelSelect.options[0].value;
        });
}

async function sendMessage() {
    const inputField = document.getElementById("user-input");
    const chatContainer = document.getElementById("chat-container");
    const sendButton = document.getElementById("send-button");

    const userMessage = inputField.value.trim();
    if (!userMessage) return;

    disableInputAndButton(inputField, sendButton, "Stop");

    chatContainer.style.display = "block";
    const conversationContainer = createConversationContainer(userMessage);
    chatContainer.appendChild(conversationContainer);

    // Create and show AI message container immediately
    const {aiMessageElement, aiMessageElementOnCopy} = createAIMessageElements(conversationContainer);
    aiMessageElement.textContent = "AI is thinking...";

    scrollToBottom(chatContainer);
    inputField.value = "";

    try {
        let sessionId = getSessionId();
        let flag = !sessionId;

        const chatResponse = await fetchChatResponse(userMessage, sessionId);
        if (!chatResponse.ok) {
            if (chatResponse.status === 429) {
                disableUIForRateLimit(inputField, sendButton);
                lockSession()
                throw new Error('已达到限制。');
            }
            if (chatResponse.status === 400) {
                throw new Error('请检查本机的设置中是否已经设置了代理，如果有请关闭代理。');
            }
            throw new Error(`Chat API error: ${chatResponse.status} - ${await getErrorMessage(chatResponse)}`);
        }

        await handleChatResponse(chatResponse, aiMessageElement, aiMessageElementOnCopy, chatContainer, userMessage);

        if (flag) {
            await handleNewSession(userMessage, sessionId);
        }

        await updateHistoryListFromServer();
    } catch (error) {
        handleError(conversationContainer, error);
    } finally {
        enableInputAndButton(inputField, sendButton, "Send");
    }
}

function disableUIForRateLimit(inputField, sendButton) {
    // 禁用所有重新回答按钮
    document.querySelectorAll('.copy-btn').forEach(btn => {
        if (btn.textContent === '重新回答') {
            btn.disabled = true;
            btn.style.backgroundColor = '#ccc';
            btn.style.cursor = 'not-allowed';
        }
    });
    // 禁用输入框
    inputField.disabled = true;
    inputField.style.backgroundColor = '#f5f5f5';
    sendButton.disabled = true;
}

function enableUIForRateLimit(inputField, sendButton) {
    // 启用所有重新回答按钮
    document.querySelectorAll('.copy-btn')
        .forEach(btn => {
            if (btn.textContent === '重新回答') {
                btn.disabled = false;
                btn.style.backgroundColor = '#f0ad4e';
                btn.style.cursor = 'pointer';
            }
        });
    // 启用输入框
    inputField.disabled = false;
    inputField.style.backgroundColor = '';
    sendButton.disabled = false;
}

function disableInputAndButton(inputField, sendButton, buttonText) {
    inputField.style.height = "5px";
    inputField.style.overflowY = "hidden";
    inputField.disabled = true;
    sendButton.disabled = true;
    sendButton.textContent = buttonText;
    sendButton.classList.add("stop");
}

function createConversationContainer(userMessage) {
    const conversationContainer = document.createElement("div");
    conversationContainer.className = "conversation";

    const userMessageElement = document.createElement("div");
    userMessageElement.className = "message user-message";
    userMessageElement.textContent = userMessage;
    // userMessageElement.style.width = "auto";
    userMessageElement.style.whiteSpace = "pre-wrap";

    conversationContainer.appendChild(userMessageElement);
    return conversationContainer;
}

async function fetchChatResponse(userMessage, sessionId) {
    return fetch("/chat", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({message: userMessage, session_id: sessionId}),
    });
}

async function lockSession() {
    const sessionId = getSessionId();
    if (!sessionId) return;

    try {
        const response = await fetch(`/lockSession/${sessionId}`, {method: "PUT"});
        if (!response.ok) {
            throw new Error(`Failed to lock session: ${response.status}`);
        }
        console.log("Session locked successfully.");
    } catch (error) {
        console.error("Error locking session:", error);
    }
}

async function getErrorMessage(response) {
    const errorData = await response.json();
    return errorData.message || 'Unknown error';
}

function createAIMessageElements(conversationContainer) {
    const aiMessageElement = document.createElement("div");
    const aiMessageElementOnCopy = document.createElement("div");
    aiMessageElement.className = "message ai-message";
    aiMessageElementOnCopy.className = "message copy ai-message";
    aiMessageElementOnCopy.style.display = "none";
    conversationContainer.appendChild(aiMessageElement);
    return {aiMessageElement, aiMessageElementOnCopy};
}

async function handleChatResponse(chatResponse, aiMessageElement, aiMessageElementOnCopy, chatContainer, userMessage) {
    sseReader = chatResponse.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let partialResponse = "";

    autoScroll = true;
    setupScrollListener(chatContainer);

    try {
        while (true) {
            const {done, value} = await sseReader.read();
            if (done) break;
            const text = decoder.decode(value);
            partialResponse += text;
            aiMessageElement.innerHTML = marked.parse(partialResponse);
            hljs.highlightAll();
            aiMessageElementOnCopy.textContent = partialResponse;
            if (autoScroll) {
                scrollToBottom(chatContainer);
            }
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            throw error;
        }
    } finally {
        addButtons(aiMessageElement, aiMessageElementOnCopy, userMessage);
        enableCodeCopy();
    }
}

function setupScrollListener(chatContainer) {
    const scrollToBottomButton = document.getElementById("scroll-to-bottom");

    chatContainer.addEventListener("wheel", (event) => {
        // 稍微放宽判断是否在底部的条件，允许一些误差（例如 10 像素）
        const isAtBottom = chatContainer.scrollHeight - chatContainer.clientHeight <= chatContainer.scrollTop + 10;

        if (event.deltaY < 0) { // 向上滚动
            autoScroll = false;
            scrollToBottomButton.style.display = "block";
        } else if (!isAtBottom) { // 向下滚动 且 不在底部
            autoScroll = false;
            scrollToBottomButton.style.display = "block";
        } else {  // 向下滚动 且 在底部
            autoScroll = true;
            scrollToBottomButton.style.display = "none";
        }
    });

    scrollToBottomButton.addEventListener("click", () => {
        autoScroll = true;
        scrollToBottom(chatContainer); // 立即滚动到底部
        scrollToBottomButton.style.display = "none";
    });
}

async function handleNewSession(userMessage, sessionId) {
    await setSessionID();
    sessionId = getSessionId();
    const titleResponse = await fetch("/generateTitle", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({message: userMessage, session_id: sessionId}),
    });

    if (!titleResponse.ok) {
        console.error(`Title API error: ${titleResponse.status}`);
        return;
    }

    try {
        const titleData = await titleResponse.json();
        let title = titleData.text.replace(/\n/g, "");
        while (Array.from(title).length < 40) {
            title += ' ';
        }
        document.getElementById("conversation-title").textContent = title || "AI Chat";
        document.getElementById("conversation-title").style.whiteSpace = "nowrap";
    } catch (titleError) {
        console.error("解析标题失败:", titleError);
    }
}

async function updateHistoryListFromServer() {
    const historyResponse = await fetch("/historyList", {method: "GET"});
    if (!historyResponse.ok) {
        console.error(`History API error: ${historyResponse.status}`);
        return;
    }
    try {
        const historyData = await historyResponse.json();
        updateHistoryList(historyData);
    } catch (historyError) {
        console.error("解析历史记录失败:", historyError);
    }
}

function handleError(conversationContainer, error, userMessage) {
    console.error("发送消息错误:", error);
    const errorContainer = document.createElement("div");
    errorContainer.className = "message ai-message error-message";

    const errorText = document.createElement("div");
    // 根据错误类型显示不同的错误信息
    if (error.message.includes('429')) {
        errorText.textContent = error.message;
    } else if (error.message.includes('400')) {
        errorText.textContent = error.message;
    } else if (error.message.includes('401')) {
        errorText.textContent = "认证失败，请重新登录。";
    } else if (error.message.includes('403')) {
        errorText.textContent = "无权限访问该资源。";
    } else if (error.message.includes('500')) {
        errorText.textContent = "服务器内部错误，请稍后重试。";
    } else if (error.message.includes('503')) {
        errorText.textContent = "服务暂时不可用，请稍后重试。";
    } else if (error.message.includes('timeout')) {
        errorText.textContent = "请求超时，请检查网络连接。";
    } else {
        errorText.textContent = "发生错误: " + error.message;
    }
    errorContainer.appendChild(errorText);

    if (userMessage) {
        const retryButton = document.createElement("button");
        retryButton.textContent = "重试";
        retryButton.className = "retry-button";
        retryButton.style.marginTop = "10px";
        retryButton.style.padding = "5px 10px";
        retryButton.style.backgroundColor = "#f0ad4e";
        retryButton.style.border = "none";
        retryButton.style.borderRadius = "3px";
        retryButton.style.cursor = "pointer";
        retryButton.onclick = () => {
            conversationContainer.remove();
            document.getElementById("user-input").value = userMessage;
            sendMessage();
        };
        errorContainer.appendChild(retryButton);
    }

    conversationContainer.appendChild(errorContainer);
}

function enableInputAndButton(inputField, sendButton, buttonText) {
    sendButton.textContent = buttonText;
    sendButton.classList.remove("stop");
    sendButton.disabled = false;
    inputField.disabled = false;
}

function scrollToBottom(chatContainer) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function enableCodeCopy() {
    document.querySelectorAll("pre").forEach((codeBlock) => {
        // 创建复制按钮
        const copyButton = document.createElement("button");
        copyButton.textContent = "复制";
        copyButton.style.position = "absolute";
        copyButton.style.right = "10px";
        copyButton.style.top = "10px";
        copyButton.style.zIndex = "10";
        copyButton.style.padding = "5px";
        copyButton.style.backgroundColor = "#007BFF";
        copyButton.style.color = "white";
        copyButton.style.border = "none";
        copyButton.style.borderRadius = "3px";
        copyButton.style.cursor = "pointer";

        // 设置代码块的父容器为相对定位
        const codeContainer = document.createElement("div");
        codeContainer.style.position = "relative";
        codeContainer.appendChild(copyButton);
        codeContainer.appendChild(codeBlock.cloneNode(true)); // 克隆代码块

        // 替换原始代码块为容器
        codeBlock.parentElement.replaceChild(codeContainer, codeBlock);

        // 添加点击事件
        copyButton.onclick = () => {
            navigator.clipboard.writeText(codeBlock.textContent)
                .then(() => {
                    copyButton.textContent = "复制成功!";
                    setTimeout(() => (copyButton.textContent = "复制"), 1500);
                })
                .catch(() => {
                    copyButton.textContent = "复制失败";
                    setTimeout(() => (copyButton.textContent = "复制"), 1500);
                });
        };
    });
}

// 在回答完成后调用 enableCodeCopy
enableCodeCopy();

// 添加按钮
function addButtons(aiMessageElement, aiMessageElementOnCopy, userMessage) {
    const buttonContainer = document.createElement("div");
    buttonContainer.style.marginTop = "10px";
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "10px";

    // 复制按钮
    const copyButton = document.createElement("button");
    copyButton.textContent = "复制";
    copyButton.className = "copy-btn";
    copyButton.onclick = () => {
        navigator.clipboard.writeText(aiMessageElementOnCopy.textContent)
            .then(() => {
                copyButton.textContent = "复制成功!";
                setTimeout(() => (copyButton.textContent = "复制"), 1500);
            })
            .catch(() => {
                copyButton.textContent = "复制失败";
                setTimeout(() => (copyButton.textContent = "复制"), 1500);
            });
    };

    // 重新回答按钮
    const retryButton = document.createElement("button");
    retryButton.textContent = "重新回答";
    retryButton.className = "copy-btn";
    retryButton.style.backgroundColor = "#f0ad4e"; // 设置按钮颜色为橙色
    retryButton.onclick = () => {
        document.getElementById("user-input").value = userMessage;
        sendMessage();
    };

    buttonContainer.appendChild(copyButton);
    buttonContainer.appendChild(retryButton);
    aiMessageElement.parentElement.appendChild(buttonContainer);
}

document.addEventListener('keydown', function (event) {
    const textarea = document.getElementById('user-input');
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault(); // 阻止默认的换行行为
        document.getElementById('send-button').click();
    } // Shift+Enter 会使用默认的换行行为
});

function adjustTextareaHeight() {
    const textarea = document.getElementById("user-input");

    textarea.style.height = '5px';
    const scrollHeight = textarea.scrollHeight - 22;
    const maxHeight = 120;
    textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
    textarea.style.overflowY = scrollHeight > maxHeight ? 'scroll' : 'hidden';
}

async function updateChatUI(id, historyData) {
    const chatContainer = document.getElementById("chat-container");
    chatContainer.style.display = "block"
    chatContainer.innerHTML = ""; // 清空现有内容

    let lastUserMessage = ""; // 用于存储最近一条用户消息
    // 遍历内容数组
    historyData.contents.forEach(content => {
        const conversationContainer = document.createElement("div");
        conversationContainer.className = "conversation";

        // 合并 parts 的 text 内容
        const messageText = content.parts.map(part => part.text).join(" ");

        const messageElement = document.createElement("div");
        messageElement.className = `message ${content.role === "user" ? "user-message" : "ai-message"}`;

        if (content.role === "user") {
            messageElement.style.whiteSpace = "pre-wrap"; // 保留换行和空格
            // 用户消息直接添加文本
            messageElement.textContent = messageText;
            lastUserMessage = messageText; // 记录用户输入
            conversationContainer.appendChild(messageElement);
        } else if (content.role === "model") {
            // AI 消息支持 Markdown 渲染
            const aiMessageElementOnCopy = document.createElement("div");
            aiMessageElementOnCopy.className = "message copy ai-message";
            aiMessageElementOnCopy.style.display = "none";
            aiMessageElementOnCopy.textContent = messageText;

            // 同步解析Markdown
            messageElement.innerHTML = marked.parse(messageText);

            // 手动执行代码高亮
            const codeBlocks = messageElement.querySelectorAll('pre code');
            codeBlocks.forEach(block => {
                hljs.highlightElement(block);
            });
            chatContainer.scrollTop = chatContainer.scrollHeight; //移动到这里，执行完高亮之后再移动滚动条。
            conversationContainer.appendChild(messageElement);
            addButtons(messageElement, aiMessageElementOnCopy, lastUserMessage);
        }
        chatContainer.appendChild(conversationContainer);
    });
    await checkAndDisableUIForRateLimit(id, document.getElementById("send-button"));
    // 滚动条保持在底部
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // 启用代码块复制功能
    enableCodeCopy();
}

async function loadHistoryById(id, title) {
    try {
        const response = await fetch(`/findHistory/${id}`, {method: 'PUT'});
        if (!response.ok) {
            throw new Error(`加载历史记录失败: ${response.status}`);
        }
        const historyData = await response.json();

        // 将title转换为字符串并去掉换行符
        title = String(title);
        title = title.replace(/\n/g, "");

        console.log(Array.from(title).length);
        // 补充标题至40个字符
        while (Array.from(title).length < 40) {
            title += ' ';
        }

        // 设置当前对话标题
        document.getElementById("conversation-title").textContent = title || "AI Chat";
        document.getElementById("conversation-title").style.whiteSpace = "nowrap";

        // 更新聊天界面
        await updateChatUI(id, historyData);

        // 存储当前对话的sessionId
        sessionStorage.setItem("sessionId", id);

        // 在历史记录中添加高亮效果
        highlightActiveHistory(id);

    } catch (error) {
        console.error("加载历史记录时出错:", error);
    }
}

async function checkAndDisableUIForRateLimit(inputField, sendButton) {
    try {
        const sessionId = getSessionId();
        if (!sessionId) return;

        const response = await fetch(`/sessionLimitedByID?id=${sessionId}`, {
            method: "GET"
        });

        if (!response.ok) {
            console.error("Failed to check session limit status:", response.status);
            return;
        }

        const isLimited = await response.json();
        if (isLimited) {
            disableUIForRateLimit(inputField, sendButton);
        }
    } catch (error) {
        console.error("Error checking session limit status:", error);
    }
}


function highlightActiveHistory(id) {
    // 获取历史记录列表
    const historyList = document.getElementById("history-list");
    const historyItems = historyList.getElementsByTagName("li");

    // 遍历所有历史记录项，移除所有项的 'active' 类
    for (let item of historyItems) {
        item.classList.remove("active");
    }

    // 根据ID找到当前被点击的历史记录项，添加 'active' 类
    const activeItem = Array.from(historyItems).find(item => {
        return item.dataset.sessionId === id.toString(); // 查找匹配的sessionId
    });

    if (activeItem) {
        activeItem.classList.add("active"); // 为当前历史记录项添加active类
    }
}

function updateHistoryList(historyData) {
    const historyList = document.getElementById("history-list");
    historyList.innerHTML = ""; // 清空列表

    if (historyData && Array.isArray(historyData)) {
        historyData.forEach(item => {
            const li = document.createElement("li");
            // 为每个历史记录项添加 sessionId 到 data 属性
            li.dataset.sessionId = item.session_id;
            // 省略号按钮（...）
            const moreButton = document.createElement("button");
            moreButton.innerHTML = "..."; // 使用三个点表示
            moreButton.style.marginRight = "10px"; // 按钮与标题之间的间距
            moreButton.addEventListener("click", (event) => {
                // 防止点击更多按钮时触发加载历史
                event.stopPropagation();

                // 弹出菜单或执行其他操作（比如编辑和删除）
                const menu = document.createElement("div");
                menu.style.position = "absolute";
                menu.style.backgroundColor = "#fff";
                menu.style.border = "1px solid #ccc";
                menu.style.padding = "10px";
                menu.style.zIndex = "1000";
                menu.style.top = `${event.clientY}px`;
                menu.style.left = `${event.clientX}px`;

                const editOption = document.createElement("div");
                editOption.textContent = "编辑";
                editOption.className = "history-menu-item edit-option";  // 添加 class
                editOption.addEventListener("click", () => {
                    editHistory(item.session_id);
                    menu.remove(); // 关闭菜单
                });
                menu.appendChild(editOption);

                const deleteOption = document.createElement("div");
                deleteOption.textContent = "删除";
                deleteOption.className = "history-menu-item delete-option"; // 添加 class
                deleteOption.addEventListener("click", () => {
                    deleteHistory(item.session_id);
                    menu.remove(); // 关闭菜单
                });
                menu.appendChild(deleteOption);

                document.body.appendChild(menu);

                // 点击外部关闭菜单
                document.addEventListener("click", () => {
                    menu.remove();
                }, {once: true});
            });
            li.appendChild(moreButton);

            // 显示标题或“无消息”，并固定长度为40个字符
            const titleSpan = document.createElement("span");
            console.log(item.title)
            while (Array.from(item.title.replace(/\n/g, "")).length < 40) {
                item.title += ' ';
            }
            titleSpan.textContent = item.title;
            titleSpan.style.whiteSpace = "nowrap";
            li.appendChild(titleSpan);

            // 点击列表项加载历史记录
            li.addEventListener("click", (event) => {
                // 阻止点击省略号按钮时触发加载历史
                if (event.target === moreButton) return;
                loadHistoryById(item.session_id, item.title.toString());
            });

            historyList.appendChild(li);
        });
    } else {
        const li = document.createElement("li");
        li.textContent = "暂无历史记录";
        historyList.appendChild(li);
    }
}

// 删除历史记录函数
function deleteHistory(sessionId) {
    if (confirm("确定要删除该历史记录吗？")) {
        // 调用后端接口删除记录
        fetch(`/deleteHistory/${sessionId}`, {method: "DELETE"})
            .then(response => {
                if (response.ok) {
                    // 刷新历史记录列表
                    historyList()
                    const id = sessionStorage.getItem("sessionId")
                    if (sessionId == id) {
                        startNewConversation()
                    }
                } else {
                    alert("删除失败，请重试！");
                }
            })
            .catch(error => {
                console.error("删除时发生错误:", error);
                alert("删除时发生错误！");
            });
    }
}

// 编辑历史记录函数
function editHistory(sessionId) {
    const newTitle = prompt("请输入新的标题：");
    if (newTitle) {
        // 调用后端接口更新标题
        fetch(`/edit-history/${sessionId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({title: newTitle})
        })
            .then(response => {
                if (response.ok) {
                    // 刷新历史记录列表
                    historyList()
                } else {
                    alert("编辑失败，请重试！");
                }
            })
            .catch(error => {
                console.error("编辑时发生错误:", error);
                alert("编辑时发生错误！");
            });
    }
}

function getSessionId() {
    let sessionId = sessionStorage.getItem('sessionId');

    // 关键修改：如果 sessionId 不存在，则返回 0
    if (!sessionId) {
        return 0;
    }

    return parseInt(sessionId); // 仍然需要转换为整数
}

function startNewConversation() {
    // 重置本地会话 ID
    sessionStorage.removeItem('sessionId'); // 或生成一个新的唯一 ID并设置
    sessionStorage.setItem('sessionId', "");

    // 清空聊天区域内容
    const chatContainer = document.getElementById("chat-container");
    chatContainer.innerHTML = "";
    document.getElementById("conversation-title").textContent = "AI Chat";
    sessionStorage.setItem("sessionId", "")
    // Remove active class from history item (if any)
    const historyList = document.getElementById("history-list");
    if (historyList) {
        const historyItems = historyList.getElementsByTagName("li");
        for (let item of historyItems) {
            item.classList.remove("active");
        }
    }
    chatContainer.style.display = "none";
    enableUIForRateLimit(document.getElementById("user-input"), document.getElementById("send-button"));
    console.log("Conversation reset successfully.");
}

// 页面加载时加载历史记录
window.onload = async () => {
    try {
        const historyResponse = await fetch("/historyList", {method: "GET"});
        if (!historyResponse.ok) {
            console.error(`History API error: ${historyResponse.status}`);
            return;
        }
        const historyData = await historyResponse.json();
        console.log("historyData : ", historyData)
        updateHistoryList(historyData);
    } catch (error) {
        console.error("Error loading history on page load:", error);
    }
};

async function historyList() {
    try {
        const historyResponse = await fetch("/historyList", {method: "GET"});
        if (!historyResponse.ok) {
            console.error(`History API error: ${historyResponse.status}`);
            return;
        }
        const historyData = await historyResponse.json();
        console.log("historyData : ", historyData)
        updateHistoryList(historyData);
    } catch (error) {
        console.error("Error loading history on page load:", error);
    }
}

document.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && event.ctrlKey) {
        document.getElementById('send-button').click();
    }
});

window.addEventListener("beforeunload", function () {
    setTimeout(() => {
        sessionStorage.setItem("sessionId", "");
    }, 0);
});

const toggleHistoryButton = document.getElementById('toggle-history');
const sidebar = document.getElementById('sidebar');

function toggleHistory() {
    sidebar.classList.toggle('collapsed');
}
