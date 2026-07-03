# gptzero.me human-checkpoint ai detector runner

Opens GPTZero in a persistent visible browser, pauses when hCaptcha or another
manual gate appears, then resumes the normal scan flow after you solve it.

This does not bypass captcha. It keeps the manual step human-controlled and
saves a redacted result trace for Jarvis-style follow-up automation.

## Usage

```powershell
python .\gptzero.me-human-checkpoint-ai-detector-runner.py C:\path\to\text.txt
```

Default browser profile:

```text
%LOCALAPPDATA%\JarvisBrowserProfiles\gptzero
```

Default run output:

```text
%LOCALAPPDATA%\JarvisRuns\gptzero
```

## Setup

```powershell
python -m pip install playwright
python -m playwright install chromium
```

If Playwright is already installed on the machine, no setup is needed.
