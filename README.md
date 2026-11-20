# JarvisV2

<p align="center">
  <img src="assets/icon.png" alt="Icono de JarvisV2" width="128">
</p>

App de escritorio para Windows para trabajar con varias sesiones de [Claude Code](https://claude.com/claude-code) organizadas en espacios de trabajo. Está hecha con Electron y xterm.js, y está inspirada en cmux de macOS.

## Funciones

- **Espacios de trabajo:** uno por carpeta de proyecto, con color propio. Se pueden renombrar con doble clic, reordenar arrastrando y colapsar la barra lateral con `Ctrl+B`.
- **Paneles divididos:** cada espacio se divide en paneles con separadores arrastrables. Cada panel es una sesión de Claude Code o una terminal PowerShell.
- **Avisos:** un indicador "Trabajando" / "Listo" por espacio y una notificación de Windows cuando un espacio en segundo plano termina.
- **Paleta de comandos:** `Ctrl+K`.
- **Reanudación:** al reabrir un panel de Claude Code continúa la conversación anterior (`claude --continue`).

## Atajos

| Atajo | Acción |
| --- | --- |
| `Ctrl+K` | Paleta de comandos |
| `Ctrl+B` | Mostrar u ocultar la barra lateral |
| `Alt+1` … `Alt+9` | Ir al espacio indicado |
| `Alt+flechas` | Moverse entre paneles |
| `Ctrl+Shift+D` | Dividir el panel a la derecha |
| `Ctrl+Shift+E` | Dividir el panel hacia abajo |
| `Ctrl+Shift+T` | Abrir una terminal a la derecha |
| `Ctrl+Shift+Enter` | Maximizar o restaurar el panel |
| `Ctrl+Shift+W` | Cerrar el panel |
| `Ctrl+Shift+N` | Nuevo espacio |
| `Ctrl +` / `Ctrl -` / `Ctrl 0` | Zoom |

## Requisitos

- Windows
- [Node.js](https://nodejs.org)
- [Claude Code](https://claude.com/claude-code) instalado y disponible como `claude` en la terminal

## Instalación y uso

```bash
npm install
node node_modules/electron/install.js
npm start
```

El segundo comando descarga el binario de Electron, porque su script de instalación no siempre se ejecuta solo tras `npm install`.

## Tecnologías

Electron, xterm.js (con los addons `fit` y `webgl`), node-pty y las fuentes Inter y JetBrains Mono. Sin frameworks de interfaz.

## Licencia

MIT
