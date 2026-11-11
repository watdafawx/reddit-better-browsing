$p = Get-Process firefox -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*ms-playwright*' }
[math]::Round(($p | Measure-Object CPU -Sum).Sum, 3)
