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

let uploadedFiles = [];

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
    const uploadedInfoDiv = document.getElementById("uploaded-files-info") || document.createElement("div");
    const fileInput = document.getElementById("file-input");

    if (files.length === 0) {
        // Check if chatContainer has any text content before hiding
        const hasContent = Array.from(chatContainer.querySelectorAll('.conversation .user-message')).some(node =>
            (node.textContent || '').trim().length > 0
        );
        if (!hasContent) {
            chatContainer.style.display = "none";
        }
        uploadedInfoDiv.style.display = "none"; // Hide the div when no files
        return;
    }

    chatContainer.style.display = "block";
    uploadedInfoDiv.id = "uploaded-files-info";
    uploadedInfoDiv.style.display = "block";

    // 清空现有内容，重新渲染
    uploadedInfoDiv.innerHTML = '';

    // Use a local array for processing, do not directly modify uploadedFiles during iteration
    const filesToProcess = Array.from(files); // Create a copy


    filesToProcess.forEach((file, index) => { // Use index from the local array

        const fileContainer = document.createElement("div");
        fileContainer.className = "file-info-container";
        fileContainer.dataset.fileIndex = String(index);  // store index for the current file list


        if (file.type.startsWith("image/")) {
            const img = document.createElement("img");
            img.src = URL.createObjectURL(file);
            img.onload = () => URL.revokeObjectURL(img.src);  // Revoke the object URL after loading
            fileContainer.appendChild(img);
        } else {
            const fileInfo = document.createElement("p");
            fileInfo.textContent = `${file.name} (${formatFileSize(file.size)})`;
            fileContainer.appendChild(fileInfo);
        }

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "file-delete-btn";
        deleteBtn.innerHTML = "×";
        deleteBtn.onclick = () => {
            const fileIndex = parseInt(fileContainer.dataset.fileIndex);

            if (!isNaN(fileIndex) && fileIndex >= 0) { // Added isNaN check
                // Find the correct index in uploadedFiles based on file identity
                const uploadedIndex = uploadedFiles.findIndex(uf => uf === filesToProcess[fileIndex]);

                if (uploadedIndex > -1) {
                    uploadedFiles.splice(uploadedIndex, 1);

                    // Update file input
                    const dt = new DataTransfer();
                    uploadedFiles.forEach(f => dt.items.add(f));
                    fileInput.files = dt.files;
                }

                //Remove the container.  Do this *after* updating uploadedFiles and fileInput
                fileContainer.remove();

                // Re-render with the updated file list, no recursion
                handleFiles(uploadedFiles);
            }
        };
        fileContainer.appendChild(deleteBtn);
        uploadedInfoDiv.appendChild(fileContainer);
    });

    // Append uploadedInfoDiv to the chat container only once
    if (!chatContainer.contains(uploadedInfoDiv)) {
        chatContainer.appendChild(uploadedInfoDiv);
    }
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function formatFileSize(size) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let index = 0;
    let sizeInUnit = size;
    while (sizeInUnit >= 1024 && index < units.length - 1) {
        sizeInUnit /= 1024;
        index++;
    }
    return `${sizeInUnit.toFixed(2)} ${units[index]}`;
}

async function sendMessage(isReply) {
    const inputField = document.getElementById("user-input");
    const chatContainer = document.getElementById("chat-container");
    const fileInput = document.getElementById("file-input");
    const uploadedFilesInfo = document.getElementById("uploaded-files-info");

    const userMessage = inputField.value.trim();

    const content_id = parseInt(inputField.dataset.content_id);
    if (!userMessage) return;
    adjustTextareaHeight()
    let files = fileInput?.files
    let fileBase64s = [];  // Store image objects

    // Process images if files exist
    if (files) {
        const totalSize = Array.from(files).reduce((sum, file) => sum + file.size, 0);
        const maxSize = 200 * 1024 * 1024; // 200MB in bytes

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
                    if (mimeType.startsWith('video/') && selectedModel === 'gemini-2.0-flash-thinking-exp') {
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

        const chatResponse = await fetchChatResponse(userMessage, sessionId, content_id, fileBase64s, isReply);
        if (!chatResponse.ok) {
            if (chatResponse.status === 429) {
                throw new Error('发生了错误，请切换模型并刷新重试');
            }
            throw new Error(`Chat API error: ${chatResponse.status} - ${await getErrorMessage(chatResponse)}`);
        }

        await handleChatResponse(chatResponse, aiMessageElement, aiMessageElementOnCopy, chatContainer, userMessage);

        if (flag) {
            await handleNewSession(userMessage, sessionId);
        }

        await updateHistoryListFromServer();
        await loadHistoryById(getSessionId(), "")
    } catch (error) {
        handleError(conversationContainer, error);
    } finally {
        fileInput.value = ""
        adjustTextareaHeight()
    }
}

function createConversationContainer(userMessage, fileBase64s = []) {
    const conversationContainer = document.createElement("div");
    conversationContainer.className = "conversation";

    const userMessageElement = document.createElement("div");
    userMessageElement.className = "message user-message";
    userMessageElement.style.whiteSpace = "pre-wrap";

    // Create wrapper for message content and edit button
    const messageWrapper = document.createElement("div");
    messageWrapper.className = "message-wrapper";

    // Add edit button
    const editButton = document.createElement("button");
    editButton.className = "edit-message-btn";
    editButton.innerHTML = '<i class="fas fa-edit"></i>';
    editButton.onclick = () => editMessage(userMessageElement, userMessage, fileBase64s);

    // Handle the text message
    const textDiv = document.createElement("div");
    textDiv.className = "message-text";
    textDiv.textContent = userMessage;

    messageWrapper.appendChild(textDiv);
    messageWrapper.appendChild(editButton);
    userMessageElement.appendChild(messageWrapper);

    // Handle media files
    if (fileBase64s.length > 0) {
        const filesContainer = document.createElement("div");
        filesContainer.className = "files-container";

        fileBase64s.forEach(file => {
            const container = document.createElement("div");
            container.className = "file-container";
            fileUI(container, file, file.mime_type);
            filesContainer.appendChild(container);
        });

        userMessageElement.appendChild(filesContainer);
    }

    conversationContainer.appendChild(userMessageElement);
    return conversationContainer;
}

function editMessage(messageElement, originalText, originalFiles = []) {
    const editContainer = document.createElement("div");
    editContainer.className = "edit-container";

    // Create textarea for text editing
    const textarea = document.createElement("textarea");
    textarea.className = "edit-textarea";
    textarea.value = originalText;
    textarea.style.width = "100%";
    textarea.style.minHeight = "60px";
    textarea.style.resize = "vertical";
    textarea.addEventListener('input', () => adjustTextareaHeight(textarea));

    // Create file input for new files
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.className = "edit-file-input";

    // Create file preview area
    const filePreview = document.createElement("div");
    filePreview.className = "edit-file-preview";

    // Add original files to preview
    // Add original files to preview
    if (originalFiles.length > 0) {
        originalFiles.forEach((file, index) => {
            const fileContainer = document.createElement("div");
            fileContainer.className = "file-container";
            fileContainer.style.position = "relative";

            // Add delete button
            const deleteBtn = document.createElement("button");
            deleteBtn.className = "file-delete-btn";
            deleteBtn.innerHTML = "×";
            deleteBtn.style.position = "absolute";
            deleteBtn.style.right = "5px";
            deleteBtn.style.top = "5px";
            deleteBtn.style.zIndex = "1";
            deleteBtn.onclick = () => {
                originalFiles.splice(index, 1);
                fileContainer.remove();
            };

            fileUI(fileContainer, file, file.mime_type);
            fileContainer.appendChild(deleteBtn);
            filePreview.appendChild(fileContainer);
        });
    }

    // Create buttons container
    const buttonsContainer = document.createElement("div");
    buttonsContainer.className = "edit-buttons";

    // Save button
    const saveButton = document.createElement("button");
    saveButton.className = "save-edit-btn";
    saveButton.textContent = "提交";
    saveButton.onclick = async () => {
        // Handle new files from the file input
        const newFiles = await handleFileInput(fileInput);

        // Set the input field value and prepare file handling
        const inputField = document.getElementById("user-input");
        inputField.value = textarea.value;

        // Get content_id from the parent conversation container
        const conversation = messageElement.closest('.conversation');
        inputField.dataset.content_id = conversation ? conversation.dataset.content_id : null;

        // Create a DataTransfer object to handle files
        const dt = new DataTransfer();

        // Add existing files that are already in base64 format
        if (originalFiles && originalFiles.length > 0) {
            originalFiles.forEach(file => {
                const blob = base64ToBlob(file.data, file.mime_type);
                const existingFile = new File([blob], `file.${file.mime_type.split('/')[1]}`, {type: file.mime_type});
                dt.items.add(existingFile);
            });
        }

        // Add new files from file input
        if (newFiles.length > 0) {
            newFiles.forEach(file => {
                const blob = base64ToBlob(file.data, file.mime_type);
                const newFile = new File([blob], `file.${file.mime_type.split('/')[1]}`, {type: file.mime_type});
                dt.items.add(newFile);
            });
        }

        // Set the combined files to the global file input
        document.getElementById("file-input").files = dt.files;

        await sendMessage(true);
        editContainer.remove();
    };

    // Cancel button
    const cancelButton = document.createElement("button");
    cancelButton.className = "cancel-edit-btn";
    cancelButton.textContent = "取消";
    cancelButton.onclick = () => {
        messageElement.innerHTML = ''; // Clear current content
        updateMessage(messageElement, originalText, originalFiles); // Restore original content
        editContainer.remove();
    };

    buttonsContainer.appendChild(saveButton);
    buttonsContainer.appendChild(cancelButton);

    // Assemble edit container
    editContainer.appendChild(textarea);
    editContainer.appendChild(fileInput);
    editContainer.appendChild(filePreview);
    editContainer.appendChild(buttonsContainer);

    // Replace original content with edit container
    messageElement.innerHTML = '';
    messageElement.appendChild(editContainer);

    // Adjust textarea height
    adjustTextareaHeight(textarea);
}

function updateMessage(messageElement, newText, newFiles) {
    const messageWrapper = document.createElement("div");
    messageWrapper.className = "message-wrapper";

    const textDiv = document.createElement("div");
    textDiv.className = "message-text";
    textDiv.textContent = newText;

    const editButton = document.createElement("button");
    editButton.className = "edit-message-btn";
    editButton.innerHTML = '<i class="fas fa-edit"></i>';
    editButton.onclick = () => editMessage(messageElement, newText, newFiles);

    messageWrapper.appendChild(textDiv);
    messageWrapper.appendChild(editButton);
    messageElement.appendChild(messageWrapper);

    if (newFiles.length > 0) {
        const filesContainer = document.createElement("div");
        filesContainer.className = "files-container";

        newFiles.forEach(file => {
            const container = document.createElement("div");
            container.className = "file-container";
            fileUI(container, file, file.mime_type);
            filesContainer.appendChild(container);
        });

        messageElement.appendChild(filesContainer);
    }
}

async function handleFileInput(fileInput) {
    const files = Array.from(fileInput.files);
    const fileBase64s = [];

    for (const file of files) {
        const base64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
        });

        fileBase64s.push({
            mime_type: file.type,
            data: base64.split(',')[1]
        });
    }

    return fileBase64s;
}

async function fetchChatResponse(userMessage, sessionId, content_id, fileBase64s, isReply) {
    return fetch("/chat", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            message: userMessage,
            session_id: sessionId,
            content_id: content_id,
            files: fileBase64s,
            is_reply: isReply
        }),
    });
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
        retryButton.onclick = async () => {
            conversationContainer.remove();
            document.getElementById("user-input").value = userMessage;
            await sendMessage(false);
        };
        errorContainer.appendChild(retryButton);
    }

    conversationContainer.appendChild(errorContainer);
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

    const retryButton = document.createElement("button");
    retryButton.textContent = "重新回答";
    retryButton.className = "copy-btn";
    retryButton.style.backgroundColor = "#f0ad4e"; // 设置按钮颜色为橙色
    retryButton.onclick = async () => {
        const conversation = retryButton.closest('.conversation');
        const previousConversation = conversation.previousElementSibling;
        const content_id = previousConversation.dataset.content_id;
        console.log("content_id", content_id)
        const userInput = document.getElementById("user-input");
        const fileInput = document.getElementById("file-input");

        userInput.value = userMessage;
        userInput.dataset.content_id = content_id;

        const fileContainers = previousConversation.querySelector(".user-message").querySelectorAll('.file-container');
        if (fileContainers && fileContainers.length > 0) {
            const dataTransfer = new DataTransfer();
            fileContainers.forEach(container => {
                // Check for media elements first
                const mediaElement = container.querySelector('img, video, audio');
                if (mediaElement) {
                    const base64Data = mediaElement.src.split(',')[1];
                    const mimeType = mediaElement.src.match(/^data:(.*?);/)[1];
                    const blob = base64ToBlob(base64Data, mimeType);
                    const file = new File([blob], `file.${mimeType.split('/')[1]}`, {type: mimeType});
                    dataTransfer.items.add(file);
                } else {
                    // Handle other file types (text, pdf, etc.)
                    const fileLink = container.querySelector('a');
                    if (fileLink) {
                        const mimeType = fileLink.href.split(';')[0].split(':')[1];
                        const base64Data = fileLink.href.split(',')[1];
                        const blob = base64ToBlob(base64Data, mimeType);
                        const file = new File([blob], `file.${getFileType(mimeType).toLowerCase()}`, {type: mimeType});
                        dataTransfer.items.add(file);
                    }
                }
            });
            fileInput.files = dataTransfer.files;
        }

        await sendMessage(true);
    };

    buttonContainer.appendChild(copyButton);
    buttonContainer.appendChild(retryButton);
    aiMessageElement.parentElement.appendChild(buttonContainer);
}

function base64ToBlob(base64, mimeType) {
    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], {type: mimeType});
}

document.addEventListener('keydown', function (event) {
    // const textarea = document.getElementById('user-input');
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

            const messageWrapper = document.createElement("div");
            messageWrapper.className = "message-wrapper";

            let inlineDataArray = [];
            content.parts.forEach(part => {
                if (part.text && !flag) {
                    const textDiv = document.createElement("div");
                    textDiv.className = "message-text";
                    textDiv.textContent = part.text;
                    messageWrapper.appendChild(textDiv);

                    // Add edit button
                    const editButton = document.createElement("button");
                    editButton.className = "edit-message-btn";
                    editButton.innerHTML = '<i class="fas fa-edit"></i>';

                    // 收集所有的 inline_data
                    content.parts.forEach(p => {
                        if (p.inline_data) {
                            inlineDataArray.push(p.inline_data);
                        }
                    });

                    editButton.onclick = () => editMessage(messageElement, part.text, inlineDataArray);
                    messageWrapper.appendChild(editButton);
                    messageElement.appendChild(messageWrapper);
                    lastUserMessage = part.text;
                    flag = true;
                }
                if (part.inline_data) {
                    const container = document.createElement("div");
                    container.className = "file-container";
                    fileUI(container, part.inline_data, part.inline_data.mime_type);
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
                            <html lang="en">
                                <head>
                                    <title>Full Size Image</title>
                                    <style>
                                        body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #000; }
                                        img { max-width: 100%; max-height: 100vh; object-fit: contain; }
                                    </style>
                                </head>
                                <body>
                                    <img src="${img.src}" alt="">
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
        textContainer.textContent = new TextDecoder('utf-8').decode(bytes);

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
                    historyList().then()
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

    // Remove active class from history item (if any)
    const historyList = document.getElementById("history-list");
    if (historyList) {
        const historyItems = historyList.getElementsByTagName("li");
        for (let item of historyItems) {
            item.classList.remove("active");
        }
    }

    // 清除文件相关内容
    const fileInput = document.getElementById("file-input");
    if (fileInput) {
        fileInput.value = "";
    }
    const uploadedFilesInfo = document.getElementById("uploaded-files-info");
    if (uploadedFilesInfo) {
        uploadedFilesInfo.innerHTML = "";
        uploadedFilesInfo.style.display = "none";
    }
    uploadedFiles = []; // 清空全局文件数组

    chatContainer.style.display = "none";
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

const sidebar = document.getElementById('sidebar');

async function fetchFontAndConvertToBase64(fontURL) {
    try {
        const response = await fetch(fontURL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64Data = reader.result;
                // IMPORTANT: Log the result to confirm it's valid.
                console.log("Font loaded and converted:", base64Data.substring(0, 50) + "..."); // Log first 50 chars
                resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error("Error fetching or converting font:", error);
        return null; // Return null on error
    }
}

async function exportToPDF() {
    const pdf = new window.jspdf.jsPDF('p', 'pt', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 40;
    let y = margin;

    // 加载自定义字体
    const fontURL = '/templates/NotoSansSC-Regular.ttf';
    const base64FontData = await fetchFontAndConvertToBase64(fontURL);
    if (!base64FontData) {
        console.error("Failed to fetch or convert font.");
        alert('Failed to load font. Please try again.');
        return;
    }
    const base64FontString = base64FontData.split(',')[1];
    pdf.addFileToVFS('NotoSansSC-Regular.ttf', base64FontString);
    pdf.addFont('NotoSansSC-Regular.ttf', 'NotoSansSC', 'normal');
    pdf.setFont('NotoSansSC');

    // 设置基础样式
    const lineHeight = 15; // 每行高度
    pdf.setFontSize(12);

    const chatContainer = document.getElementById("chat-container");
    const titleElement = document.getElementById("conversation-title");

    if (!chatContainer || !titleElement) {
        alert('HTML elements not found.');
        return;
    }

    // 获取标题用于文件名，但不显示在 PDF 内容中
    const title = titleElement.textContent.trim().normalize('NFKC');

    // 计算当前页剩余行数
    function getRemainingLines() {
        return Math.floor((pageHeight - margin - y) / lineHeight);
    }

    // 绘制文本并处理分页
    function drawTextWithPagination(lines, textColor) {
        let remainingLines = getRemainingLines();

        // 如果当前页没有足够空间，换页
        if (remainingLines <= 0) {
            pdf.addPage();
            y = margin; // 移除标题后，直接从 margin 开始
            remainingLines = getRemainingLines();
        }

        // 截取当前页能显示的行数
        const linesToDraw = lines.slice(0, remainingLines);
        const remainingTextLines = lines.slice(remainingLines);

        // 绘制当前页的文本
        pdf.setFontSize(12);
        pdf.setTextColor(...textColor); // 解构 textColor 数组为单独参数
        pdf.text(linesToDraw, margin, y);
        y += linesToDraw.length * lineHeight;

        // 如果还有剩余行，递归处理
        if (remainingTextLines.length > 0) {
            pdf.addPage();
            y = margin; // 移除标题后，直接从 margin 开始
            drawTextWithPagination(remainingTextLines, textColor);
        }
    }

    const conversations = chatContainer.getElementsByClassName("conversation");

    for (const conv of conversations) {
        // 用户消息
        const userMsg = conv.querySelector(".user-message");
        if (userMsg) {
            const userText = userMsg.innerText.trim().normalize('NFKC');
            const userLines = pdf.splitTextToSize(userText, pageWidth - 2 * margin);

            // 绘制用户消息（蓝色）
            drawTextWithPagination(userLines, [0, 0, 255]);
            y += 5; // 用户消息后加 5pt 间距
        }

        // AI 回复
        const aiMsg = conv.querySelector(".ai-message:not(.copy)") || conv.querySelector(".ai-message.copy");
        if (aiMsg) {
            const aiText = aiMsg.innerText.trim().normalize('NFKC');
            const aiLines = pdf.splitTextToSize(aiText, pageWidth - 2 * margin);

            // 绘制 AI 回复（绿色）
            drawTextWithPagination(aiLines, [0, 128, 0]);
            y += 10; // AI 回复后加 10pt 间距
        }

        // 对话之间的间距
        y += 5;

        // 如果接近页面底部，换页
        if (y > pageHeight - margin - 30) {
            pdf.addPage();
            y = margin; // 移除标题后，直接从 margin 开始
        }
    }

    // 使用标题作为文件名
    pdf.save(`${title}.pdf`);
}