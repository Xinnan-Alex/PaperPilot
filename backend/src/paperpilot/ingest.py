from pathlib import Path

from paperpilot.config import settings
from paperpilot.logging import log
from paperpilot.models import Page


def extract_text(file_path: str) -> list[Page]:
    ext = Path(file_path).suffix.lower()

    if ext == ".pdf":
        return _extract_pdf(file_path)
    elif ext in (".docx", ".doc"):
        return _extract_docx(file_path)
    elif ext in (".txt", ".text", ".md"):
        return _extract_text(file_path)
    elif ext in (".html", ".htm"):
        return _extract_html(file_path)
    else:
        raise ValueError(f"Unsupported file type: {ext}")


def _extract_pdf(file_path: str) -> list[Page]:
    from pypdf import PdfReader

    reader = PdfReader(file_path)
    pages: list[Page] = []

    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if text and text.strip():
            pages.append(Page(page_num=i + 1, text=text.strip()))
        else:
            ocr_text = _ocr_pdf_page(file_path, i)
            if ocr_text and ocr_text.strip():
                pages.append(Page(page_num=i + 1, text=ocr_text.strip()))

    return pages


def _ocr_pdf_page(file_path: str, page_index: int) -> str | None:
    try:
        import pytesseract
        from pdf2image import convert_from_path
    except ImportError:
        log.warning(
            "ocr_dependencies_missing", message="Install pytesseract and pdf2image for OCR support"
        )
        return None

    try:
        images = convert_from_path(
            file_path, first_page=page_index + 1, last_page=page_index + 1, dpi=300
        )
        if not images:
            return None
        text: str = str(pytesseract.image_to_string(images[0], lang=settings.ocr_language))
        return text.strip() or None
    except Exception:
        log.warning("ocr_failed", file_path=file_path, page=page_index + 1)
        return None


def _extract_docx(file_path: str) -> list[Page]:
    from docx import Document

    doc = Document(file_path)
    full_text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    return [Page(page_num=1, text=full_text)] if full_text.strip() else []


def _extract_text(file_path: str) -> list[Page]:
    text = Path(file_path).read_text(encoding="utf-8")
    return [Page(page_num=1, text=text)] if text.strip() else []


def _extract_html(file_path: str) -> list[Page]:
    from bs4 import BeautifulSoup

    html = Path(file_path).read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(separator="\n")
    return [Page(page_num=1, text=text)] if text.strip() else []
