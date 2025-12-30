# 🏥 Sistema Médico - Dra. Cristina García Domínguez

Sistema de gestión de consultorio médico para la **Dra. Cristina García Domínguez**, Pediatra Cardiólogo.

![Vista del Sistema](https://img.shields.io/badge/Estado-Activo-brightgreen) ![Versión](https://img.shields.io/badge/Versión-1.2-blue)

## 📋 Descripción

Sistema web completo para la gestión de citas médicas, pacientes y estadísticas del consultorio. Integrado con Google Sheets para la captura de datos de citas a través de formularios.

## ✨ Novedades v1.2 (Diciembre 2025)
- **Centro de Notificaciones Inteligente**: Visualiza citas recién creadas al instante.
- **Modo Oscuro**: Interfaz adaptable para reducir fatiga visual.
- **Búsqueda Global**: Encuentra pacientes y sus historiales rápidamente.
- **Gestión Avanzada**: Notas en citas, impresión de agenda y estados de atención.
- **Seguridad**: Manejo de sesiones mejorado.

## ✨ Características Principales

### 🔐 Autenticación
- Sistema de login seguro con roles (Administrador, Secretaria)
- Diseño premium con tarjeta dividida (Split Card)

### 📅 Gestión de Agenda
- Visualización de citas por día
- **Calendario modal personalizado** para navegación rápida entre fechas
- Navegación día a día con botones Anterior/Siguiente

### 👥 Gestión de Pacientes
- Listado completo de pacientes
- Búsqueda por nombre o teléfono
- Información detallada: especialidad, tipo de seguro, historial de citas

### 📊 Estadísticas Avanzadas
- **Gráficos interactivos** de:
  - Especialidades solicitadas
  - Tipo de consulta (Seguro/Privado)
  - Motivos principales de consulta
- **Estadísticas financieras**:
  - Ingresos totales y por tipo de consulta
  - Promedio por cita
  - Ingresos por especialidad
- **Gráfico de ingresos mensuales** con barras apiladas
- Filtros interactivos para análisis personalizado

### 🎨 Interfaz de Usuario
- Diseño moderno y elegante con paleta de colores profesional
- **Toast notifications** para feedback al usuario
- **Modales de confirmación** personalizados
- **Date Picker modal** con calendario visual
- Totalmente responsive

## 🛠️ Tecnologías

- **Frontend**: HTML5, CSS3 (Vanilla), JavaScript (ES6+)
- **Backend**: Python (Flask) - Para proxy de Google Sheets
- **Base de Datos**: Google Sheets (vía API)
- **Fuentes**: Google Fonts (Outfit, Inter)

## 📁 Estructura del Proyecto

```
Proyecto medico/
├── index.html          # Página principal
├── styles.css          # Estilos CSS
├── app.js              # Lógica JavaScript
├── server.py           # Servidor Python (proxy)
├── start.bat           # Script de inicio
├── README.md           # Este archivo
├── MANUAL_USUARIO.md   # Manual de uso
├── PROJECT_TRACKER.md  # Estado del proyecto
└── RESUMEN_EJECUTIVO.md # Resumen ejecutivo
```

## 🚀 Inicio Rápido

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/deliabreu17/Proyecto-medico---Cristina.git
   ```

2. **Ejecutar el sistema**
   - Doble clic en `start.bat` (Windows)
   - O abrir `index.html` directamente en el navegador

3. **Credenciales de acceso**
   - **Usuario**: `admin`
   - **Contraseña**: `admin123`

## 👩‍⚕️ Información del Consultorio

- **Doctora**: Dra. Cristina García Domínguez
- **Especialidad**: Pediatra Cardiólogo
- **Sistema desarrollado**: Diciembre 2025

## 📄 Licencia

Proyecto privado - Todos los derechos reservados.

---

Desarrollado con ❤️ para el consultorio de la Dra. Cristina García Domínguez.
