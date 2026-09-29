#!/usr/bin/env python3
"""Build a static page set from hand-written HTML page bodies.

Usage: python3 scripts/docs-builder/build.py --source <dir> --target <dir> [--profile <name>]

The source folder holds one body per page (`<slug>.html`), a shared `_style.html`, and a
`site.json` naming the pages in nav order with the site's brand, head links and footer.
Each page is written to `<target>/<slug>.html`, wrapped in the same chrome: a nav bar
above the body and the footer below it. Links in the bodies are kept as written, so
relative links resolve when the target sits where the bodies expect it.

A profile in `site.json` adapts the output for another host. Its `rewrite` pairs are
applied to every page in order, and each page in its `fragment` list is written without
the document skeleton, for a host that wraps the page itself.
"""
import argparse, json, pathlib, sys

HEAD = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n')

def nav(site, current):
    items = []
    for slug, label, _ in site["pages"]:
        cur = ' aria-current="page"' if slug == current else ""
        items.append(f'<a href="{slug}.html"{cur}>{label}</a>')
    return (f'<header class="top"><div class="in"><a class="brand" href="index.html">{site["brand"]}</a>'
            '<nav aria-label="Pages">' + "".join(items) + '</nav></div></header>')

def page(site, slug, title, body, style, full):
    inner = f"<title>{title}</title>\n{site['head']}\n{style}\n"
    chrome = (f"{nav(site, slug)}\n"
              f'<main class="wrap">\n\n{body}\n</main>\n'
              f'<footer class="wrap small" style="padding-block:0 32px">{site["footer"]}</footer>\n')
    if full:
        return HEAD + inner + "</head>\n<body>\n" + chrome + "</body>\n</html>\n"
    return inner + chrome

def main():
    ap = argparse.ArgumentParser(description="Build a static page set from HTML page bodies.")
    ap.add_argument("--source", required=True, type=pathlib.Path, help="folder with site.json, _style.html and the page bodies")
    ap.add_argument("--target", required=True, type=pathlib.Path, help="folder the built pages are written to")
    ap.add_argument("--profile", help="a profile named in site.json")
    args = ap.parse_args()

    site = json.loads((args.source / "site.json").read_text(encoding="utf-8"))
    profile = {}
    if args.profile:
        profile = site.get("profiles", {}).get(args.profile)
        if profile is None:
            sys.exit(f"no profile {args.profile!r} in {args.source / 'site.json'}")
    style = (args.source / "_style.html").read_text(encoding="utf-8").rstrip("\n")

    args.target.mkdir(parents=True, exist_ok=True)
    for slug, _, title in site["pages"]:
        body = (args.source / f"{slug}.html").read_text(encoding="utf-8").rstrip("\n")
        html = page(site, slug, title, body, style, full=slug not in profile.get("fragment", []))
        for old, new in profile.get("rewrite", []):
            html = html.replace(old, new)
        (args.target / f"{slug}.html").write_text(html, encoding="utf-8")
        print("wrote", args.target / f"{slug}.html", len(html))

if __name__ == "__main__":
    main()
