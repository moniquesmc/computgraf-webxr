# 📦 Cubagem & Picking — WebXR

Sistema de Realidade Aumentada (WebXR) com **Three.js** para auxílio logístico.

## 🚀 Como Executar

### GitHub Pages (recomendado)
```bash
git init && git add . && git commit -m "feat: cubagem webxr"
git branch -M main
git remote add origin https://github.com/SEU_USER/cubagem-webxr.git
git push -u origin main
```
Settings → Pages → Branch: main → Save.

### Local + ngrok
```bash
npx http-server -p 8080
npx ngrok http 8080
```

## 📐 Regras
| Cor | Volume |
|-----|--------|
| 🔴 Vermelho | V > 12.000 cm³ |
| 🟢 Verde | 4.000 < V ≤ 12.000 cm³ |
| 🔵 Azul | V ≤ 4.000 cm³ |

### Empilhamento
✅ Mesma cor · ✅ Azul→Verde/Vermelha · ✅ Verde→Vermelha
❌ Vermelha→Verde/Azul · ❌ Verde→Azul

## 🖥️ Modo Simulação
Para dispositivos sem AR: botão **"Modo Simulação"** abre a cena 3D interativa com OrbitControls.

## 📁 Estrutura
```
├── index.html
├── app.js
├── style.css
└── README.md
```
