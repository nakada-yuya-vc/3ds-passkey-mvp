import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ChallengePage } from './ChallengePage'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/challenge/:acsTransId" element={<ChallengePage />} />
        <Route path="*" element={<div style={{ padding: 24 }}>チャレンジURLが必要です</div>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
