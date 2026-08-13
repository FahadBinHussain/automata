# Notion file upload (local notes)

reusable script: `C:\Users\<user>\Downloads\automata\notion.com\notion-upload-file.ps1`

- args: `-PageId`, `-FilePath`, optional `-FileName`/`-ContentType`; token read from the mainframe notion profile (default `<email>`).
- the script creates the upload object, POSTs the bytes with auth headers, and attaches the file block.

## raw flow / API gotchas (reference)

- the API enforces a hardcoded extension whitelist, not a blanket size rule: accepted are `.7z`, `.zip`, `.docx`, `.pdf`, `.pptx`, `.xlsx`, `.txt`, `.md`, `.csv`, `.html`, `.css`, `.json`, `.xml`, `.gif`, `.jpg`, `.png`, `.svg`, `.webp`, `.mp3`, `.ogg`, `.wav`, `.avi`, `.mov`, `.mp4`; blocked are `.bat`, `.bin`, `.db`, `.dll`, `.exe`, `.ini`, `.js`, `.rar`, `.reg`, `.sav`.
- blocked extension: rename to `.txt` and record the real extension in page metadata, or package into `.zip`/`.7z`.
- `PATCH /v1/blocks/{page_id}/children` with `{"children":[{"type":"file","file":{"type":"file_upload","file_upload":{"id":"{id}"}}}]}`.
- verify `content_type` matches the whitelist (`.rar` fails even with `application/x-rar-compressed`).
- attach within **1 hour** of creating the upload object.