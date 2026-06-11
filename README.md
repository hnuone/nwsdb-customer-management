# NWSDB Customer Management - Matara Regional Office

A bilingual (Sinhala/English) Flask web application for managing disconnected water supply customers through a staged workflow pipeline.

## Workflow Pipeline

Disconnected → First Reminders → Ferrule Processing → OIC Orders → Second Reminders → Legal Proceed

**Reconnected** customers exit the pipeline at any stage.

## Features

- Import customers from Excel (`.xlsx`) or CSV
- Auto-extract scheme code from account number (`31/33/...` → `Makandura WSS`)
- Generate PDF First Reminder Letters (based on official template)
- Ferrule Processing with decision tracking (approve/hold/reconnect)
- Generate OIC Orders with PDF output (Rs. 3,540 reconnection charge)
- Generate Second Reminder Letters (final warning)
- Legal report generation for Head Office
- Bulk mark reconnected via CSV upload or checkboxes
- Scheme-based filtering and full-text search on all pages
- Bilingual UI (English/Sinhala) with language toggle

## Requirements

- Python 3.10+
- See `requirements.txt`

## Setup

```bash
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000

## Project Structure

```
├── app.py              # Flask routes and PDF generation
├── database.py         # Models, schema, scheme extraction
├── i18n.py             # Sinhala/English translations
├── requirements.txt    # Python dependencies
├── run.bat             # Windows launcher
├── templates/          # Jinja2 templates
├── storage/            # Source Excel and DOCX templates
├── letters_output/     # Generated PDF letters (gitignored)
├── reports_output/     # Generated legal reports (gitignored)
└── instance/           # SQLite database (gitignored)
```
