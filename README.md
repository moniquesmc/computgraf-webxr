# 📦 Cubagem & Picking — WebXR

Sistema de Realidade Aumentada baseado em WebXR + Three.js para auxílio logístico em centros de distribuição.

## 🎯 Objetivo

Auxiliar operadores de logística a visualizar o preenchimento de espaços (cubagem) e simular carregamento de caminhões (picking) através de sobreposição digital de dados em Realidade Aumentada.

## ✅ Requisitos Técnicos Atendidos

| Requisito | Status | Detalhes |
|-----------|--------|----------|
| **Three.js** | ✅ | Three.js v0.164.1 via ES Modules |
| **WebXR Device API** | ✅ | `navigator.xr.requestSession('immersive-ar')` — sem soluções legadas |
| **Hit Testing** | ✅ | `requestHitTestSource` + `getHitTestResults` para detecção de superfícies reais |
| **Cor pelo Volume** | ✅ | Vermelho: V > 32.000 cm³ · Verde: 12.000 < V ≤ 32.000 cm³ · Azul: V ≤ 12.000 cm³ |
| **Dimensões Aleatórias** | ✅ | Largura, altura e profundidade geradas randomicamente (0.05m a 0.60m) |
| **Empilhamento por Cor** | ✅ | Mesma cor ✓ · Azul→Verde/Vermelha ✓ · Verde→Vermelha ✓ · Demais bloqueados |
| **Destaque Visual** | ✅ | Preview fica vermelho pulsante quando empilhamento é impossível |

## 📐 Módulo A — Cubagem Virtual

- O usuário aponta a câmera para uma superfície real (chão/mesa) via AR ou usa o Modo Simulação
- Ao clicar em **Colocar**, empilha virtualmente caixas coloridas
- As regras de empilhamento são validadas em tempo real
- Preview fantasma mostra onde a caixa será posicionada

## 🚛 Módulo B — Picking Guiado

- Simula uma **caçamba de caminhão** (4.8m × 3.0m × 12.0m)
- No AR: detecta superfície para posicionar a caçamba; na Simulação: caçamba já aparece
- Sistema **destaca visualmente** (preview vermelho pulsante) quando:
  - A caixa está fora dos limites da caçamba
  - O empilhamento viola as regras de cor
- Toast de erro textual reforça o feedback

## 🎨 Sistema de Cores (por Volume)

| Cor | Condição | Thresholds |
|-----|----------|------------|
| 🔴 Vermelha | V > X | V > 32.000 cm³ |
| 🟢 Verde | Y < V ≤ X | 12.000 < V ≤ 32.000 cm³ |
| 🔵 Azul | V ≤ Y | V ≤ 12.000 cm³ |

**Regras de Empilhamento:**
- ✅ Mesma cor sobre mesma cor
- ✅ Azul sobre Verde ou Vermelha
- ✅ Verde sobre Vermelha
- ❌ Vermelha sobre Verde ou Azul
- ❌ Verde sobre Azul

## 🖥️ Como Usar

### AR (Celular)
1. Abra no **Chrome Android** com ARCore instalado
2. Clique em **Iniciar AR**
3. Aponte para uma superfície plana
4. Use os botões para colocar/desfazer/resetar caixas
5. Alterne entre Cubagem e Picking

### Simulação (Desktop)
1. Clique em **Modo Simulação**
2. Use mouse para orbitar (arrastar), zoom (scroll)
3. O crosshair central indica onde a caixa será colocada
4. Clique em caixas existentes para selecioná-las
5. WASD/Setas: mover caixa | Q/E: subir/descer | ESC: desselecionar

## 📁 Estrutura do Projeto

```
├── index.html    # Página principal com HUD e overlay
├── style.css     # Estilos (tema rosa/roxo escuro)
├── app.js        # Lógica principal (Three.js + WebXR)
└── README.md     # Este arquivo
```

## 🔧 Tecnologias

- **Three.js** v0.164.1 (ES Modules via CDN)
- **WebXR Device API** (Hit Testing, Immersive AR)
- **OrbitControls** (modo simulação)
- HTML5 / CSS3 / JavaScript ES Modules

## 🚀 Deploy

1. Envie para o **GitHub**
2. Ative **GitHub Pages**: Settings → Pages → main → Save
3. Acesse pelo celular (Chrome Android + ARCore) para AR
4. Ou use no desktop com Modo Simulação
