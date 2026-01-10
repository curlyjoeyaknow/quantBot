#!/usr/bin/env python3
import argparse
import csv
import re
import sys
import time
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2})\b")
MONEY_RE = re.compile(r"\$\s?\d[\d,]*(?:\.\d{2})?")

def with_page_param(url: str, page_num: int) -> str:
    """Return URL with (or replacing) page=N query param."""
    u = urlparse(url)
    qs = parse_qs(u.query)
    qs["page"] = [str(page_num)]
    new_query = urlencode(qs, doseq=True)
    return urlunparse((u.scheme, u.netloc, u.path, u.params, new_query, u.fragment))

def norm_abs_url(base: str, href: str) -> str:
    if href.startswith("http://") or href.startswith("https://"):
        return href
    if href.startswith("/"):
        b = urlparse(base)
        return f"{b.scheme}://{b.netloc}{href}"
    return href

def guess_year(text: str):
    m = YEAR_RE.search(text or "")
    return m.group(1) if m else ""

def extract_lot_id(url: str):
    # Best-effort: many Grays lot URLs include an ID-ish segment.
    # We'll grab the last long-ish token of digits if present.
    m = re.search(r"(\d{5,})", url)
    return m.group(1) if m else ""

def extract_cards(page):
    """
    Extract listing cards from the current rendered search results page.
    We:
      - find anchors that look like lot links
      - walk up to a reasonable container
      - read its innerText for price/location/time cues
    Returns list[dict].
    """
    js = r"""
    () => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const lotAnchors = anchors.filter(a => {
        const href = a.getAttribute('href') || '';
        // Heuristics for Grays lot pages:
        return href.includes('/lot/') || href.includes('/lot-') || href.includes('lot');
      });

      const seen = new Set();
      const items = [];

      function findContainer(el) {
        // Walk up a bit to find a card-like container.
        let cur = el;
        for (let i = 0; i < 6 && cur; i++) {
          if (cur.tagName === 'ARTICLE') return cur;
          const role = cur.getAttribute && cur.getAttribute('role');
          if (role === 'listitem') return cur;
          const testid = cur.getAttribute && cur.getAttribute('data-testid');
          if (testid && /item|card|result/i.test(testid)) return cur;
          cur = cur.parentElement;
        }
        return el.closest('article') || el.closest('[role="listitem"]') || el.parentElement;
      }

      for (const a of lotAnchors) {
        const href = a.getAttribute('href') || '';
        const abs = href; // normalize in python
        if (seen.has(abs)) continue;
        seen.add(abs);

        const container = findContainer(a);
        const titleEl =
          container?.querySelector('h3, h2, [data-testid*="title"], .title') ||
          a.querySelector('h3, h2') ||
          a;

        const title = (titleEl?.innerText || a.innerText || '').trim();
        const blob = (container?.innerText || '').trim();

        items.push({
          href: abs,
          title,
          blob,
        });
      }
      return items;
    }
    """
    raw = page.evaluate(js)
    out = []
    for r in raw:
        href = (r.get("href") or "").strip()
        title = (r.get("title") or "").strip()
        blob = (r.get("blob") or "").strip()

        # Pull some best-effort fields from blob
        money = ""
        mm = MONEY_RE.search(blob)
        if mm:
            money = mm.group(0).replace(" ", "")

        # "Location" / state-ish text is inconsistent; keep a fuzzy line.
        # We'll choose a short line that contains VIC/NSW/QLD/etc or "Melbourne" etc if present.
        loc = ""
        for line in [ln.strip() for ln in blob.splitlines() if ln.strip()]:
            if any(s in line for s in ["VIC", "NSW", "QLD", "SA", "WA", "TAS", "ACT", "NT"]):
                loc = line
                break

        # Time-left / end: look for lines with "Ends", "End", "Time left", "Closing"
        tleft = ""
        for line in [ln.strip() for ln in blob.splitlines() if ln.strip()]:
            if re.search(r"\b(Ends?|Closing|Time\s*Left|Bid\s*Now)\b", line, re.I):
                tleft = line
                break

        out.append({
            "title": title,
            "href": href,
            "price_text": money,
            "location_text": loc,
            "time_text": tleft,
            "year": guess_year(title),
        })
    return out

def try_accept_cookies(page):
    # Best-effort cookie accept clickers. Safe to fail.
    candidates = [
        "button:has-text('Accept')",
        "button:has-text('I Accept')",
        "button:has-text('Agree')",
        "button:has-text('Got it')",
        "text=Accept all",
        "text=Accept All",
    ]
    for sel in candidates:
        try:
            btn = page.locator(sel).first
            if btn and btn.is_visible(timeout=500):
                btn.click(timeout=800)
                return True
        except Exception:
            pass
    return False

def scrape(url: str, out_csv: str, max_pages: int, headful: bool, delay_s: float):
    rows = []
    seen_urls = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headful)
        context = browser.new_context(
            viewport={"width": 1400, "height": 900},
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari"
        )
        page = context.new_page()

        for page_num in range(1, max_pages + 1):
            page_url = with_page_param(url, page_num) if max_pages > 1 else url
            print(f"[+] Loading page {page_num}: {page_url}", file=sys.stderr)

            try:
                page.goto(page_url, wait_until="domcontentloaded", timeout=60000)
                # Some pages need a moment for client rendering
                try:
                    page.wait_for_load_state("networkidle", timeout=15000)
                except PlaywrightTimeoutError:
                    pass

                try_accept_cookies(page)

                # Little scroll to trigger lazy content if used
                page.mouse.wheel(0, 1200)
                time.sleep(0.5)
                page.mouse.wheel(0, 1200)
                time.sleep(0.5)

                cards = extract_cards(page)
            except Exception as e:
                print(f"[!] Failed page {page_num}: {e}", file=sys.stderr)
                break

            new_count = 0
            for c in cards:
                abs_url = norm_abs_url(url, c["href"])
                if abs_url in seen_urls:
                    continue
                seen_urls.add(abs_url)
                new_count += 1

                rows.append({
                    "title": c["title"],
                    "year": c["year"],
                    "lot_id": extract_lot_id(abs_url),
                    "price_text": c["price_text"],
                    "location_text": c["location_text"],
                    "time_text": c["time_text"],
                    "url": abs_url,
                    "source_page": page_num,
                })

            print(f"    -> extracted {len(cards)} candidates, +{new_count} new", file=sys.stderr)

            # If a page yields nothing new, we probably hit the end or paging isn't supported.
            if page_num > 1 and new_count == 0:
                print("[+] No new items found; stopping.", file=sys.stderr)
                break

            time.sleep(delay_s)

        context.close()
        browser.close()

    # Write CSV
    fieldnames = ["title", "year", "lot_id", "price_text", "location_text", "time_text", "url", "source_page"]
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)

    print(f"[✓] Wrote {len(rows)} rows to {out_csv}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description="Extract Grays search listings to CSV (best-effort).")
    ap.add_argument("--url", required=True, help="Full Grays search URL (tab=items etc).")
    ap.add_argument("--out", default="grays_listings.csv", help="Output CSV path.")
    ap.add_argument("--max-pages", type=int, default=20, help="Max pages to try (uses ?page=N).")
    ap.add_argument("--headful", action="store_true", help="Run with visible browser window.")
    ap.add_argument("--delay", type=float, default=1.0, help="Delay between pages (seconds).")
    args = ap.parse_args()

    scrape(args.url, args.out, args.max_pages, args.headful, args.delay)


if __name__ == "__main__":
    main()
