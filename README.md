# 📦 Cubagem & Picking — WebXR

Sistema de Realidade Aumentada baseado na Web (WebXR) com **Three.js** para auxílio logístico.

---

## 🚀 Como Executar

### Opção 1 — GitHub Pages (recomendado para entrega)
```bash
git init
git add .
git commit -m "feat: sistema cubagem e picking WebXR"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/cubagem-webxr.git
git push -u origin main
```
Ative GitHub Pages: Settings → Pages → Branch: main → Save.

### Opção 2 — Servidor local + ngrok
```bash
npx http-server -p 8080
# Em outro terminal:
npx ngrok http 8080
```
Acesse a URL HTTPS no celular Android com Chrome.

---

## 📐 Regras de Cores (Volume)
| Cor          | Condição                 |
|--------------|--------------------------|
| 🔴 Vermelho  | Volume > 12.000 cm³      |
| 🟢 Verde     | 4.000 < V ≤ 12.000 cm³  |
| 🔵 Azul      | Volume ≤ 4.000 cm³       |

## 🧱 Regras de Empilhamento
- ✅ Mesma cor sobre mesma cor
- ✅ Azul sobre Verde ou Vermelha
- ✅ Verde sobre Vermelha
- ❌ Vermelha sobre Verde ou Azul
- ❌ Verde sobre Azul

## 📱 Requisitos
- **Google Chrome** no **Android** com **ARCore**
- Acesso via **HTTPS** (obrigatório para WebXR)

## 📁 Estrutura
```
cubagem-webxr/
├── index.html
├── app.js
├── style.css
└── README.md
```

## 👤 Autor
[Seu Nome] — [Sua Matrícula]
