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
        deleteBtn.onclick = () => fileContainer.remove();
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