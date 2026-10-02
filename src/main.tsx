import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Глобальный обработчик ошибок
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error)
  const root = document.getElementById('root')
  if (root && !root.hasChildNodes()) {
    root.innerHTML = `
      <div style="color:white;padding:40px;text-align:center;font-family:sans-serif;background:#0d1218;min-height:100vh;">
        <h2 style="color:#f2a33c;">Произошла ошибка</h2>
        <p>${event.message || 'Неизвестная ошибка'}</p>
        <button onclick="location.reload()" style="margin-top:20px;padding:10px 20px;background:#f2a33c;color:#0d1218;border:none;border-radius:4px;cursor:pointer;font-size:16px;">
          Перезагрузить страницу
        </button>
      </div>
    `
  }
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason)
})

try {
  ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
} catch (error) {
  console.error('Failed to render app:', error)
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = `
      <div style="color:white;padding:40px;text-align:center;font-family:sans-serif;background:#0d1218;min-height:100vh;">
        <h2 style="color:#f2a33c;">Ошибка запуска</h2>
        <p>Не удалось запустить приложение</p>
        <button onclick="location.reload()" style="margin-top:20px;padding:10px 20px;background:#f2a33c;color:#0d1218;border:none;border-radius:4px;cursor:pointer;font-size:16px;">
          Перезагрузить страницу
        </button>
      </div>
    `
  }
}
