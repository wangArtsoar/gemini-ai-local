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

let selectedModel = "gemini-2.0-flash"; // 默认模型

function changeModel() {
    const modelSelect = document.getElementById("model-select");
    selectedModel = modelSelect.value;
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

function handlePaste(event) {
    // Check if the paste event contains files
    if (event.clipboardData.files.length > 0) {
        event.preventDefault();
        handleFiles(event.clipboardData.files);
        const fileInput = document.getElementById("file-input");
        fileInput.files = event.clipboardData.files;
    }
}

function handleFiles(files) {
    const chatContainer = document.getElementById("chat-container");
    const uploadedInfoDiv = document.createElement("div");

    chatContainer.style.display = "block";
    uploadedInfoDiv.id = "uploaded-files-info";
    uploadedInfoDiv.style.display = "block";

    Array.from(files).forEach(file => {
        const fileContainer = document.createElement("div");
        fileContainer.className = "file-info-container";

        if (file.type.startsWith("image/")) {
            // Handle image files
            const img = document.createElement("img");
            img.src = URL.createObjectURL(file);
            img.onload = () => URL.revokeObjectURL(img.src);
            fileContainer.appendChild(img);
        } else {
            // Handle other file types
            const fileInfo = document.createElement("p");
            fileInfo.textContent = `${file.name} (${formatFileSize(file.size)})`;
            fileContainer.appendChild(fileInfo);
        }

        // Add delete button
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "file-delete-btn";
        deleteBtn.innerHTML = "×";
        deleteBtn.onclick = () => {
            fileContainer.remove();
            if (uploadedInfoDiv.children.length === 0) {
                uploadedInfoDiv.style.display = "none";
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }
        fileContainer.appendChild(deleteBtn);

        uploadedInfoDiv.appendChild(fileContainer);
    });

    chatContainer.appendChild(uploadedInfoDiv);
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    else return (bytes / 1048576).toFixed(1) + " MB";
}

async function sendMessage() {
    const inputField = document.getElementById("user-input");
    const chatContainer = document.getElementById("chat-container");
    const sendButton = document.getElementById("send-button");
    const fileInput = document.getElementById("file-input");
    const uploadedFilesInfo = document.getElementById("uploaded-files-info");

    const userMessage = inputField.value.trim();

    const content_id = parseInt(inputField.dataset.content_id);
    if (!userMessage) return;

    let files = fileInput?.files
    let fileBase64s = [];  // Store image objects

    // Process images if files exist
    if (files) {
        const totalSize = Array.from(files).reduce((sum, file) => sum + file.size, 0);
        const maxSize = 200 * 1024 * 1024; // 20MB in bytes

        if (totalSize > maxSize) {
            alert("文件总大小不能超过200MB。");
            return;
        }

        for (let i = 0; i < files.length; i++) {
            const reader = new FileReader();
            reader.readAsDataURL(files[i]);
            await new Promise((resolve) => {
                reader.onload = function () {
                    // 从 Data URL 中提取 MIME 类型
                    const result = reader.result;
                    const match = result.match(/^data:([^;]+);/);
                    const mimeType = match ? match[1] : files[i].type;
                    const mediaTypes = ['image/', 'video/', 'audio/'];
                    const isMediaFile = mediaTypes.some(type => mimeType.startsWith(type));
                    const isSupportedFile = getFileIcon(mimeType) !== "far fa-file";
                    // Check if video file is not supported for certain models
                    if (mimeType.startsWith('video/') &&
                        (selectedModel === 'gemini-2.0-pro' || selectedModel === 'gemini-2.0-flash-thinking-exp')) {
                        alert("当前模型不支持视频文件输入。");
                        return;
                    }
                    if (!isMediaFile && !isSupportedFile) {
                        alert("不支持上传此类型文件。");
                        return;
                    }
                    fileBase64s.push({
                        mime_type: mimeType,
                        data: result.split(',')[1] // 去掉前缀部分
                    });
                    resolve();
                };
            });
        }
    }

    disableInputAndButton(inputField, sendButton, "Stop");

    chatContainer.style.display = "block";
    const conversationContainer = createConversationContainer(userMessage, fileBase64s);
    chatContainer.appendChild(conversationContainer);

    if (uploadedFilesInfo) {
        uploadedFilesInfo.innerHTML = ""
        uploadedFilesInfo.style.display = "none"; // Hide the file info container
    }
    // Create and show AI message container immediately
    const {aiMessageElement, aiMessageElementOnCopy} = createAIMessageElements(conversationContainer);
    aiMessageElement.textContent = "AI is thinking...";

    scrollToBottom(chatContainer);
    inputField.value = ""; // Clear the input field

    try {
        let sessionId = getSessionId();
        let flag = !sessionId;

        const chatResponse = await fetchChatResponse(userMessage, sessionId, content_id, fileBase64s);
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
        fileInput.value = ""
        enableInputAndButton(inputField, sendButton, "Send");
        await loadHistoryById(getSessionId(), "")
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

    // Add click handler for stop button
    if (buttonText === "Stop") {
        sendButton.onclick = () => {
            if (sseReader) {
                sseReader.cancel(); // Cancel the SSE connection
                sseReader = null;
            }
            enableInputAndButton(inputField, sendButton, "Send");
            sendButton.onclick = null; // Remove the stop handler
        };
    }
}

function createConversationContainer(userMessage, fileBase64s = []) {
    const conversationContainer = document.createElement("div");
    conversationContainer.className = "conversation";

    const userMessageElement = document.createElement("div");
    userMessageElement.className = "message user-message";
    userMessageElement.style.whiteSpace = "pre-wrap";

    // Handle the text message
    const textDiv = document.createElement("div");
    textDiv.textContent = userMessage;
    userMessageElement.appendChild(textDiv);

    // Handle media files
    if (fileBase64s.length > 0) {
        fileBase64s.forEach(file => {
            const container = document.createElement("div");
            container.className = "file-container";

            fileUI(container, file, file.mime_type);

            userMessageElement.appendChild(container);
        });
    }

    conversationContainer.appendChild(userMessageElement);
    return conversationContainer;
}

async function fetchChatResponse(userMessage, sessionId, content_id, fileBase64s) {
    return fetch("/chat", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({message: userMessage, session_id: sessionId, content_id: content_id, files: fileBase64s}),
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
        const content_id = retryButton.closest('.conversation').parentElement.querySelector('.conversation').dataset.content_id;
        document.getElementById("user-input").value = userMessage;
        document.getElementById("user-input").dataset.content_id = content_id;
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
        conversationContainer.dataset.content_id = content.content_id; // Add content ID as data attribute

        const messageElement = document.createElement("div");
        messageElement.className = `message ${content.role === "user" ? "user-message" : "ai-message"}`;

        let flag = false;
        if (content.role === "user") {
            messageElement.style.whiteSpace = "pre-wrap"; // 保留换行和空格
            content.parts.forEach(part => {
                if (part.text && !flag) {
                    const textDiv = document.createElement("div");
                    textDiv.textContent = part.text;
                    messageElement.appendChild(textDiv);
                    lastUserMessage = part.text;
                    flag = true;
                }
                if (part.inline_data) {
                    const container = document.createElement("div");
                    container.className = "file-container";

                    const mimeType = part.inline_data.mime_type;

                    fileUI(container, part.inline_data, mimeType);

                    messageElement.appendChild(container);
                }
            });
            conversationContainer.appendChild(messageElement);
        } else if (content.role === "model") {
            const aiMessageElementOnCopy = document.createElement("div");
            aiMessageElementOnCopy.className = "message copy ai-message";
            aiMessageElementOnCopy.style.display = "none";

            content.parts.forEach(part => {
                if (part.text) {
                    messageElement.innerHTML += marked.parse(part.text);
                    aiMessageElementOnCopy.textContent += part.text;
                }
                if (part.inline_data) {
                    const imgContainer = document.createElement("div");
                    imgContainer.className = "image-thumbnail-container";

                    const img = document.createElement("img");
                    img.src = `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
                    img.className = "image-thumbnail";
                    img.style.maxWidth = "200px";
                    img.style.maxHeight = "200px";
                    img.style.cursor = "pointer";

                    img.onclick = () => {
                        const fullImg = window.open("", "_blank");
                        fullImg.document.write(`
                            <html>
                                <head>
                                    <title>Full Size Image</title>
                                    <style>
                                        body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #000; }
                                        img { max-width: 100%; max-height: 100vh; object-fit: contain; }
                                    </style>
                                </head>
                                <body>
                                    <img src="${img.src}">
                                </body>
                            </html>
                        `);
                    };

                    imgContainer.appendChild(img);
                    messageElement.appendChild(imgContainer);
                }
            });

            // 手动执行代码高亮
            const codeBlocks = messageElement.querySelectorAll('pre code');
            codeBlocks.forEach(block => {
                hljs.highlightElement(block);
            });

            chatContainer.scrollTop = chatContainer.scrollHeight;
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

function fileUI(container, part, mimeType) {
    if (mimeType.startsWith('image/')) {
        // Handle images
        const imgContainer = document.createElement("div");
        imgContainer.className = "image-thumbnail-container";

        const img = document.createElement("img");
        img.src = `data:${mimeType};base64,${part.data}`;
        img.className = "image-thumbnail";
        img.style.maxWidth = "200px";
        img.style.maxHeight = "200px";
        img.style.cursor = "pointer";

        img.onclick = () => createMediaModal(img.src, 'image');
        imgContainer.appendChild(img);
        container.appendChild(imgContainer);
    } else if (mimeType.startsWith('video/')) {
        // Handle videos
        const video = document.createElement("video");
        video.src = `data:${mimeType};base64,${part.data}`;
        video.controls = true;
        video.style.maxWidth = "300px";
        video.style.cursor = "pointer";
        video.onclick = () => createMediaModal(video.src, 'video');
        container.appendChild(video);
    } else if (mimeType.startsWith('audio/')) {
        // Handle audio
        const audio = document.createElement("audio");
        audio.src = `data:${mimeType};base64,${part.data}`;
        audio.controls = true;
        container.appendChild(audio);
    } else if (mimeType.startsWith('text/') || mimeType === 'application/pdf') {
        // Handle text files and PDFs
        const linkContainer = document.createElement("div");
        linkContainer.style.display = "flex";
        linkContainer.style.alignItems = "center";
        linkContainer.style.backgroundColor = "var(--message-bg-color)";
        linkContainer.style.padding = "8px 12px";
        linkContainer.style.borderRadius = "6px";
        linkContainer.style.border = "1px solid var(--border-color)";

        const fileIcon = document.createElement("i");
        fileIcon.className = getFileIcon(mimeType);
        fileIcon.style.marginRight = "15px";
        fileIcon.style.fontSize = "18px";
        fileIcon.style.color = "var(--text-color)";

        const previewButton = document.createElement("button");
        previewButton.textContent = "预览";
        previewButton.style.padding = "6px 12px";
        previewButton.style.marginRight = "12px";
        previewButton.style.backgroundColor = "var(--ai-message-bg-color)";
        previewButton.style.color = "var(--text-color)";
        previewButton.style.border = "1px solid var(--border-color)";
        previewButton.style.borderRadius = "4px";
        previewButton.style.cursor = "pointer";
        previewButton.style.transition = "all 0.2s ease";
        previewButton.onclick = () => createDocumentModal(part.data, mimeType);

        const downloadLink = document.createElement("a");
        downloadLink.href = `data:${mimeType};base64,${part.data}`;
        downloadLink.download = "document";
        downloadLink.textContent = "下载";
        downloadLink.style.padding = "6px 12px";
        downloadLink.style.backgroundColor = "var(--ai-message-bg-color)";
        downloadLink.style.color = "var(--text-color)";
        downloadLink.style.border = "1px solid var(--border-color)";
        downloadLink.style.borderRadius = "4px";
        downloadLink.style.transition = "all 0.2s ease";

        // Add hover effects
        previewButton.onmouseover = () => {
            previewButton.style.backgroundColor = "var(--history-hover-bg-color)";
        };
        previewButton.onmouseout = () => {
            previewButton.style.backgroundColor = "var(--ai-message-bg-color)";
        };

        downloadLink.onmouseover = () => {
            downloadLink.style.backgroundColor = "rgba(0, 123, 255, 0.2)";
        };
        downloadLink.onmouseout = () => {
            downloadLink.style.backgroundColor = "rgba(0, 123, 255, 0.1)";
        };

        linkContainer.appendChild(fileIcon);
        linkContainer.appendChild(previewButton);
        linkContainer.appendChild(downloadLink);
        container.appendChild(linkContainer);
    } else {
        // Handle other files with download only
        const fileLink = document.createElement("a");
        fileLink.href = `data:${mimeType};base64,${part.data}`;
        fileLink.download = "document";

        const fileIcon = document.createElement("i");
        fileIcon.className = getFileIcon(mimeType);
        fileIcon.style.marginRight = "10px";

        const fileName = document.createElement("span");
        fileName.textContent = getFileType(mimeType);

        fileLink.appendChild(fileIcon);
        fileLink.appendChild(fileName);
        container.appendChild(fileLink);
    }
}

function createMediaModal(src, type) {
    const modal = document.createElement("div");
    modal.style.position = "fixed";
    modal.style.top = "0";
    modal.style.left = "0";
    modal.style.width = "100%";
    modal.style.height = "100%";
    modal.style.backgroundColor = "rgba(0,0,0,0.9)";
    modal.style.display = "flex";
    modal.style.justifyContent = "center";
    modal.style.alignItems = "center";
    modal.style.zIndex = "1000";

    const mediaElement = type === 'image'
        ? document.createElement("img")
        : document.createElement("video");

    mediaElement.src = src;
    mediaElement.style.maxWidth = "90%";
    mediaElement.style.maxHeight = "90vh";
    mediaElement.style.objectFit = "contain";

    if (type === 'video') {
        mediaElement.controls = true;
    }

    modal.appendChild(mediaElement);
    document.body.appendChild(modal);

    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    };
}

function getFileIcon(mimeType) {
    switch (true) {
        case mimeType.includes('pdf'):
            return 'far fa-file-pdf';
        case mimeType.includes('javascript'):
            return 'far fa-file-code';
        case mimeType.includes('python'):
            return 'fab fa-python';
        case mimeType.includes('text'):
            return 'far fa-file-alt';
        case mimeType.includes('html'):
            return 'far fa-file-code';
        case mimeType.includes('css'):
            return 'far fa-file-code';
        case mimeType.includes('csv'):
            return 'far fa-file-excel';
        case mimeType.includes('xml'):
            return 'far fa-file-code';
        default:
            return 'far fa-file';
    }
}

function getFileType(mimeType) {
    return mimeType.split('/')[1].toUpperCase();
}

function createDocumentModal(base64Data, mimeType) {
    const modal = document.createElement("div");
    modal.style.position = "fixed";
    modal.style.top = "0";
    modal.style.left = "0";
    modal.style.width = "100%";
    modal.style.height = "100%";
    modal.style.backgroundColor = "rgba(0,0,0,0.9)";
    modal.style.display = "flex";
    modal.style.justifyContent = "center";
    modal.style.alignItems = "center";
    modal.style.zIndex = "1000";

    const isDarkTheme = localStorage.getItem('theme') === 'dark-theme';

    if (mimeType === 'application/pdf') {
        const iframe = document.createElement("iframe");
        iframe.src = `data:${mimeType};base64,${base64Data}`;
        iframe.style.width = "70%";
        iframe.style.height = "70%";
        iframe.style.border = "none";
        modal.appendChild(iframe);
    } else {
        const textContainer = document.createElement("div");
        textContainer.style.backgroundColor = isDarkTheme ? '#2d2d2d' : 'white';
        textContainer.style.color = isDarkTheme ? '#e0e0e0' : 'black';
        textContainer.style.padding = "20px";
        textContainer.style.width = "60%";
        textContainer.style.height = "60%";
        textContainer.style.overflowY = "auto";
        textContainer.style.whiteSpace = "pre-wrap";
        textContainer.style.borderRadius = "8px";
        textContainer.style.boxShadow = isDarkTheme ?
            "0 4px 6px rgba(0, 0, 0, 0.5)" :
            "0 4px 6px rgba(0, 0, 0, 0.1)";

        // 正确解码UTF-8编码的base64文本
        const binary = atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const decodedText = new TextDecoder('utf-8').decode(bytes);
        textContainer.textContent = decodedText;

        modal.appendChild(textContainer);
    }

    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    };

    document.body.appendChild(modal);
}

async function loadHistoryById(id, title) {
    try {
        const response = await fetch(`/findHistory/${id}`, {method: 'PUT'});
        if (!response.ok) {
            throw new Error(`加载历史记录失败: ${response.status}`);
        }
        const historyData = await response.json();

        if (title !== "") {
            // 将title转换为字符串并去掉换行符
            title = String(title);
            title = title.replace(/\n/g, "");

            // 补充标题至40个字符
            while (Array.from(title).length < 40) {
                title += ' ';
            }

            // 设置当前对话标题
            document.getElementById("conversation-title").textContent = title || "AI Chat";
            document.getElementById("conversation-title").style.whiteSpace = "nowrap";
        }

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
            li.dataset.sessionId = item.session_id;

            // 省略号按钮（...）
            const moreButton = document.createElement("button");
            moreButton.innerHTML = "..."; // 使用三个点表示
            moreButton.style.marginRight = "10px"; // 按钮与标题之间的间距
            moreButton.addEventListener("click", (event) => {
                event.stopPropagation();

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

                document.addEventListener("click", () => {
                    menu.remove();
                }, {once: true});
            });
            li.appendChild(moreButton);

            // 显示标题或“无消息”，并固定长度为40个字符
            const titleSpan = document.createElement("span");
            while (Array.from(item.title.replace(/\n/g, "")).length < 40) {
                item.title += ' ';
            }
            titleSpan.textContent = item.title;
            titleSpan.style.whiteSpace = "nowrap";
            li.appendChild(titleSpan);

            // 点击列表项加载历史记录
            li.addEventListener("click", (event) => {
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
    sessionStorage.removeItem('sessionId');
    sessionStorage.setItem('sessionId', "");

    // 清空聊天区域内容
    const chatContainer = document.getElementById("chat-container");
    chatContainer.innerHTML = "";
    document.getElementById("conversation-title").textContent = "AI Chat";

    // Remove active class from history item (if any)
    const historyList = document.getElementById("history-list");
    if (historyList) {
        const historyItems = historyList.getElementsByTagName("li");
        for (let item of historyItems) {
            item.classList.remove("active");
        }
    }

    // 隐藏聊天容器
    chatContainer.style.display = "none";

    // 确保输入框和发送按钮可用
    const inputField = document.getElementById("user-input");
    const sendButton = document.getElementById("send-button");
    inputField.disabled = false;
    inputField.style.backgroundColor = '';
    sendButton.disabled = false;
    sendButton.textContent = "Send";

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
