#!/usr/bin/env python3
"""Assemble Game Night Madness into single-file web pages.

    python3 build.py   ->  index.html    the app (GitHub Pages serves this)
                           preview.html  sample shelf on one phone, for a quick look without BGG

Sources live in src/. The layout CSS, Levi's tiebreaker coin and the QR library in src/shared/
come from Dinner Madness, so the two apps look and behave alike.
"""
import pathlib
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / 'src'


def read(p):
    return (SRC / p).read_text(encoding='utf-8').strip()


icon = ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='#5B3FD0'/>"
        "<path d='M6.5 9.5h6.5v13H6.5M13 16h6.5' fill='none' stroke='white' stroke-width='2.8' stroke-linecap='round' stroke-linejoin='round'/>"
        "<circle cx='23.6' cy='16' r='3.4' fill='white'/></svg>")
icon_url = 'data:image/svg+xml,' + urllib.parse.quote(icon, safe=" ='/:,.")

head = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Game Night Madness</title>
<meta name="description" content="Can't decide what to play? Pull the games from your BoardGameGeek shelf, seed them into a tournament-style bracket, and let the whole table vote until one game is left standing.">
<meta name="theme-color" content="#5B3FD0">
<meta property="og:title" content="Game Night Madness">
<meta property="og:description" content="Vote on what we play tonight, bracket style.">
<link rel="icon" href="{icon_url}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Big+Shoulders+Display:wght@700;800;900&display=swap">
<style>
{read('palette.css')}
{read('shared/layout.css')}
{read('extra.css')}
</style>
{read('shared/coin-art.html')}
<style>
{read('shared/coin.css')}
</style>'''

app = read('app.js')
assert '/*@SAMPLE@*/' in app
app = app.replace('/*@SAMPLE@*/', read('sample.js'))


def page(extra_script=''):
    return (head + '\n' + read('body.html') + '\n\n<script>\n' + read('shared/qrcode.js') + '\n</script>\n' +
            extra_script + '<script>\n' + app + '\n</script>\n</body>\n</html>\n')


for name, extra in (('index.html', ''), ('preview.html', '<script>window.GNM_PREVIEW = true;</script>\n')):
    (HERE / name).write_text(page(extra), encoding='utf-8')
    print(name, round((HERE / name).stat().st_size / 1024, 1), 'KB')
