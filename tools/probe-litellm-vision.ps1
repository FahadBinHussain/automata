# probe: does the rule-14 LiteLLM gateway serve vision (image parts)?
$ErrorActionPreference = 'Stop'
$uri = 'https://alchoholpad-litellm.hf.space/v1/chat/completions'
$png = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes('C:\tmp\pasted-image.png'))
$body = @{
    model    = 'deepseek-v4.1-flash-1017'
    messages = @(
        @{ role = 'system'; content = 'You are a vision assistant. Reply with only a plain factual description of the image: what it shows, colors, and any visible text verbatim.' }
        @{ role = 'user'; content = @(
            @{ type = 'text'; text = 'describe this image' }
            @{ type = 'image_url'; image_url = @{ url = "data:image/png;base64,$png" } }
        ) }
    )
} | ConvertTo-Json -Depth 8

try {
    $resp = Invoke-RestMethod -Uri $uri -Method Post -Headers @{ Authorization = 'Bearer sk-1234' } -ContentType 'application/json' -Body $body -TimeoutSec 120
    Write-Host 'SUCCESS'
    $resp.choices[0].message.content | Write-Host
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Write-Host "FAILED status=$status"
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host $reader.ReadToEnd()
    } catch { Write-Host $_.Exception.Message }
}