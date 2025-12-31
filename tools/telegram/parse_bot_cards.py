import re

from dataclasses import dataclass, asdict

from typing import Optional, List, Dict, Any, Tuple





# NOTE: Pattern matches TypeScript consolidated extractor in @quantbot/utils
# See packages/utils/src/address/patterns.py for shared patterns
BASE58_RE = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")

WS = r"[ \t\u00A0]*"  # include nbsp





def safe_str(x):

    if x is None:

        return ""

    return str(x).replace("\u0000", "").replace("\r\n", "\n")





def find_mint_addresses(text: str) -> List[str]:

    # Common: mint is printed on its own line. We still return all matches.

    return list(dict.fromkeys(BASE58_RE.findall(text or "")))





def parse_number_suffix(s: str) -> Optional[float]:

    """

    Parse things like:

      3.6M, 97.7K, 8.1B, 1600, 1.6K

    Returns float (raw value in units), not rounded.

    """

    if s is None:

        return None

    s = s.strip()

    s = s.replace(",", "")

    m = re.match(r"^\$?([0-9]+(?:\.[0-9]+)?)\s*([KMB])?$", s, re.IGNORECASE)

    if not m:

        return None

    num = float(m.group(1))

    suf = (m.group(2) or "").upper()

    mult = {"": 1.0, "K": 1e3, "M": 1e6, "B": 1e9}.get(suf, 1.0)

    return num * mult





def parse_percent(s: str) -> Optional[float]:

    """

    Returns percent as float (e.g. '-17%' -> -17.0)

    """

    if s is None:

        return None

    s = s.strip().replace(" ", "")

    m = re.match(r"^([+-]?\d+(?:\.\d+)?)%$", s)

    if not m:

        return None

    return float(m.group(1))





def parse_age_to_days(s: str) -> Optional[int]:

    """

    Parse '26d' -> 26, '5w' -> 35, '16d' -> 16

    """

    if not s:

        return None

    s = s.strip().lower()

    m = re.match(r"^(\d+)\s*([dw])$", s)

    if not m:

        return None

    n = int(m.group(1))

    unit = m.group(2)

    return n if unit == "d" else n * 7





def strip_ansi(s: str) -> str:

    # just in case logs include ansi

    return re.sub(r"\x1b\[[0-9;]*m", "", s or "")





@dataclass

class RickCard:

    bot: str

    token_name: Optional[str]

    ticker: Optional[str]

    chain: Optional[str]

    platform: Optional[str]



    mint: Optional[str]



    price_usd: Optional[float]

    mcap_usd: Optional[float]

    mcap_change_pct: Optional[float]



    fdv_now_usd: Optional[float]

    ath_mcap_usd: Optional[float]

    ath_age_days: Optional[int]



    liquidity_usd: Optional[float]

    liquidity_ratio_x: Optional[float]

    tax_pct: Optional[float]



    volume_usd: Optional[float]

    age_days: Optional[int]



    chg_1h_pct: Optional[float]

    turnover_1h_usd: Optional[float]

    buys_1h: Optional[int]

    sells_1h: Optional[int]



    top_holders_pct: Optional[List[float]]

    top_holders_sum_pct: Optional[float]



    total_holders: Optional[int]

    avg_wallet_age_days: Optional[int]



    fresh_1d_pct: Optional[float]

    fresh_7d_pct: Optional[float]



    links_present: Optional[List[str]]

    tags: Optional[List[str]]



    raw_text: str





@dataclass

class PhanesCard:

    bot: str

    token_name: Optional[str]

    ticker: Optional[str]

    chain: Optional[str]

    platform: Optional[str]

    mint: Optional[str]

    views: Optional[int]

    age_days: Optional[int]

    price_usd: Optional[float]

    mcap_usd: Optional[float]

    vol_usd: Optional[float]

    liquidity_usd: Optional[float]

    chg_1h_pct: Optional[float]

    buys_1h: Optional[int]

    sells_1h: Optional[int]

    ath_mcap_usd: Optional[float]

    ath_drawdown_pct: Optional[float]

    ath_age_days: Optional[int]

    socials_present: Optional[List[str]]

    raw_text: str





# Handle percentages with K/M/B suffixes like "36.6K%" or "20.4%"
_RICK_HEADER_RE = re.compile(

    rf"^\s*🟡{WS}(?P<name>.+?){WS}\[(?P<mcap>[^/\]]+){WS}/{WS}(?P<chg>[+-]?\d+(?:\.\d+)?(?:K|M|B)?%){WS}\]{WS}\$\$?(?P<ticker>[A-Za-z0-9_]+)",

    re.MULTILINE,

)



_RICK_CHAIN_RE = re.compile(r"^\s*🌐\s*(?P<chain>[A-Za-z0-9_ -]+?)\s*@\s*(?P<platform>.+?)\s*$", re.MULTILINE)

_RICK_USD_RE = re.compile(r"^\s*💰\s*USD:\s*\$(?P<price>[0-9]+(?:\.[0-9]+)?)\s*$", re.MULTILINE)

# FDV: $1.3M -> 1.6M [16d] OR FDV: $347K ⇨ ATH: $911K [1h]
# Handle both formats: with/without "ATH:" and with/without $ on ATH
_RICK_FDV_RE = re.compile(r"^\s*💎\s*FDV:\s*\$(?P<now>[0-9.]+[KMB]?)\s*[->⇨]\s*(?:ATH:\s*)?\$?(?P<ath>[0-9.]+[KMB]?)\s*\[(?P<age>\d+[dw])\]\s*$", re.MULTILINE)

_RICK_LIQ_RE = re.compile(r"^\s*💦\s*Liq:\s*\$(?P<liq>[^ \t]+)\s*\[x(?P<x>[0-9]+(?:\.[0-9]+)?)\]\s*.*?(?P<tax>[0-9]+(?:\.[0-9]+)?)%\s*$", re.MULTILINE)

_RICK_VOL_RE = re.compile(r"^\s*📊\s*Vol:\s*\$(?P<vol>[^ \t]+)\s*⋅\s*Age:\s*(?P<age>\d+[dw])\s*$", re.MULTILINE)

# Handle both 📈 and 🚀 for 1H line
_RICK_1H_RE = re.compile(r"^\s*[📈🚀]\s*1H:\s*(?P<chg>[+-]?\d+(?:\.\d+)?)%\s*⋅\s*\$(?P<turn>[^ \t]+)\s*🅑\s*(?P<buys>\d+)\s*Ⓢ\s*(?P<sells>\d+)\s*$", re.MULTILINE)

_RICK_TH_RE = re.compile(r"^\s*👥\s*TH:\s*(?P<parts>[0-9.\u22c5]+)\s*\[(?P<sum>[0-9]+(?:\.[0-9]+)?)%\]\s*$", re.MULTILINE)

_RICK_TOTAL_RE = re.compile(r"^\s*🤝\s*Total:\s*(?P<tot>[^ \t]+)\s*⋅\s*avg\s*(?P<avg>\d+[dw])\s*old\s*$", re.MULTILINE)

_RICK_FRESH_RE = re.compile(r"^\s*🌱\s*Fresh\s*1D:\s*(?P<d1>[0-9]+(?:\.[0-9]+)?)%\s*⋅\s*7D:\s*(?P<d7>[0-9]+(?:\.[0-9]+)?)%\s*$", re.MULTILINE)

_RICK_CHART_RE = re.compile(r"^\s*💹\s*Chart:\s*(?P<items>.+?)\s*$", re.MULTILINE)

_RICK_MORE_RE = re.compile(r"^\s*🧰\s*More:\s*(?P<items>.+?)\s*$", re.MULTILINE)





_PHANES_HEADER_RE = re.compile(r"^\s*🟣\s*(?P<name>.+?)\s*\(\$(?P<ticker>[A-Za-z0-9_]+)\)\s*$", re.MULTILINE)

# └ #SOL (Raydium) | 🌱4h | 👁️4.5K
_PHANES_CHAIN_AGE_VIEWS_RE = re.compile(r"^\s*└\s*#(?P<chain>[A-Za-z0-9_]+)\s*(?:\((?P<platform>[^)]+)\))?\s*\|\s*(?:🌱)?(?P<age>\d+[dw])\s*\|\s*👁️\s*(?P<views>\d+)\s*$", re.MULTILINE)

_PHANES_STATS_RE = re.compile(r"^\s*├\s*(?P<k>USD|MC|Vol|LP|1H|ATH)\s+(?P<v>.+?)\s*$", re.MULTILINE)

_PHANES_1H_LINE_RE = re.compile(r"(?P<chg>[+-]?\d+(?:\.\d+)?)%\s+🅑\s*(?P<buys>\d+)\s+Ⓢ\s*(?P<sells>\d+)")

_PHANES_ATH_LINE_RE = re.compile(r"\$(?P<ath>[0-9.]+[KMB]?)\s*\((?P<dd>[-+]?\d+(?:\.\d+)?)%\s*/\s*(?P<age>\d+[dw])\)")

_PHANES_SOCIALS_RE = re.compile(r"^\s*🔗\s*Socials\s*$\n(?P<line>^\s*└.*$)", re.MULTILINE)





def parse_rick_card(text: str) -> Optional[Dict[str, Any]]:

    text = strip_ansi(text)

    mints = find_mint_addresses(text)

    mint = mints[0] if mints else None



    h = _RICK_HEADER_RE.search(text)

    if not h:

        return None



    token_name = safe_str(h.group("name")).strip()

    ticker = safe_str(h.group("ticker")).strip()

    mcap_raw = safe_str(h.group("mcap")).strip()

    chg_raw = safe_str(h.group("chg")).strip()



    mcap_usd = parse_number_suffix(mcap_raw)

    mcap_change_pct = parse_percent(chg_raw)



    chain = None

    platform = None

    m = _RICK_CHAIN_RE.search(text)

    if m:

        chain = safe_str(m.group("chain")).strip()

        platform = safe_str(m.group("platform")).strip()



    price_usd = None

    m = _RICK_USD_RE.search(text)

    if m:

        price_usd = float(m.group("price"))



    fdv_now_usd = None

    ath_mcap_usd = None

    ath_age_days = None

    m = _RICK_FDV_RE.search(text)

    if m:
        # Current market cap is after "FDV: $"
        fdv_now_usd = parse_number_suffix(m.group("now"))
        # ATH is after "->" without $ sign
        ath_mcap_usd = parse_number_suffix(m.group("ath"))
        ath_age_days = parse_age_to_days(m.group("age"))



    liquidity_usd = None

    liquidity_ratio_x = None

    tax_pct = None

    m = _RICK_LIQ_RE.search(text)

    if m:

        liquidity_usd = parse_number_suffix(m.group("liq"))

        liquidity_ratio_x = float(m.group("x"))

        tax_pct = float(m.group("tax"))



    volume_usd = None

    age_days = None

    m = _RICK_VOL_RE.search(text)

    if m:

        volume_usd = parse_number_suffix(m.group("vol"))

        age_days = parse_age_to_days(m.group("age"))



    chg_1h_pct = None

    turnover_1h_usd = None

    buys_1h = None

    sells_1h = None

    m = _RICK_1H_RE.search(text)

    if m:

        chg_1h_pct = float(m.group("chg"))

        turnover_1h_usd = parse_number_suffix(m.group("turn"))

        buys_1h = int(m.group("buys"))

        sells_1h = int(m.group("sells"))



    top_holders_pct = None

    top_holders_sum_pct = None

    m = _RICK_TH_RE.search(text)

    if m:

        parts = m.group("parts").split("⋅")

        top_holders_pct = [float(p) for p in parts if p.strip()]

        top_holders_sum_pct = float(m.group("sum"))



    total_holders = None

    avg_wallet_age_days = None

    m = _RICK_TOTAL_RE.search(text)

    if m:

        total_holders = int(parse_number_suffix(m.group("tot")) or 0)

        avg_wallet_age_days = parse_age_to_days(m.group("avg"))



    fresh_1d_pct = None

    fresh_7d_pct = None

    m = _RICK_FRESH_RE.search(text)

    if m:

        fresh_1d_pct = float(m.group("d1"))

        fresh_7d_pct = float(m.group("d7"))



    links_present: List[str] = []

    m = _RICK_CHART_RE.search(text)

    if m:

        links_present += [x.strip() for x in m.group("items").replace("⋅", " ").split() if x.strip()]

    m = _RICK_MORE_RE.search(text)

    if m:

        # store as tokens (emojis + bracket flags)

        links_present += [x.strip() for x in m.group("items").split() if x.strip()]

    links_present = links_present or None



    # Tags block usually below mint; grab tokens like "MAE⋅BAN⋅..."

    tags: List[str] = []

    for line in text.splitlines():

        if "⋅" in line and re.search(r"[A-Z]{2,}", line):

            # avoid chart/more lines (already parsed)

            if "Chart:" in line or "More:" in line:

                continue

            tags += [t.strip() for t in line.split("⋅") if t.strip() and re.fullmatch(r"[A-Z0-9]{2,5}", t.strip())]

    tags = tags or None



    card = RickCard(

        bot="rick",

        token_name=token_name,

        ticker=ticker,

        chain=chain,

        platform=platform,

        mint=mint,

        price_usd=price_usd,

        mcap_usd=mcap_usd,

        mcap_change_pct=mcap_change_pct,

        fdv_now_usd=fdv_now_usd,

        ath_mcap_usd=ath_mcap_usd,

        ath_age_days=ath_age_days,

        liquidity_usd=liquidity_usd,

        liquidity_ratio_x=liquidity_ratio_x,

        tax_pct=tax_pct,

        volume_usd=volume_usd,

        age_days=age_days,

        chg_1h_pct=chg_1h_pct,

        turnover_1h_usd=turnover_1h_usd,

        buys_1h=buys_1h,

        sells_1h=sells_1h,

        top_holders_pct=top_holders_pct,

        top_holders_sum_pct=top_holders_sum_pct,

        total_holders=total_holders,

        avg_wallet_age_days=avg_wallet_age_days,

        fresh_1d_pct=fresh_1d_pct,

        fresh_7d_pct=fresh_7d_pct,

        links_present=links_present,

        tags=tags,

        raw_text=text,

    )

    return asdict(card)





def parse_phanes_card(text: str) -> Optional[Dict[str, Any]]:

    text = strip_ansi(text)

    mints = find_mint_addresses(text)

    mint = mints[0] if mints else None



    h = _PHANES_HEADER_RE.search(text)

    if not h:

        return None



    token_name = safe_str(h.group("name")).strip()

    ticker = safe_str(h.group("ticker")).strip()



    chain = None
    platform = None
    age_days = None
    views = None

    m = _PHANES_CHAIN_AGE_VIEWS_RE.search(text)

    if m:
        chain = safe_str(m.group("chain")).strip()
        platform = safe_str(m.group("platform")).strip() if m.group("platform") else None
        age_days = parse_age_to_days(m.group("age"))
        views = int(m.group("views"))



    # Stats block parsing

    price_usd = None

    mcap_usd = None

    vol_usd = None

    liquidity_usd = None

    chg_1h_pct = None

    buys_1h = None

    sells_1h = None

    ath_mcap_usd = None

    ath_drawdown_pct = None

    ath_age_days = None



    for st in _PHANES_STATS_RE.finditer(text):

        k = st.group("k").strip()

        v = safe_str(st.group("v")).strip()



        if k == "USD":

            # "$0.0036 (-17%)" -> price, and ignore change here (Rick has it more structured)

            m2 = re.search(r"\$(?P<p>[0-9]+(?:\.[0-9]+)?)", v)

            if m2:

                price_usd = float(m2.group("p"))

        elif k == "MC":

            # "$3.59M"

            mcap_usd = parse_number_suffix(v)

        elif k == "Vol":

            vol_usd = parse_number_suffix(v)

        elif k == "LP":

            liquidity_usd = parse_number_suffix(v)

        elif k == "1H":

            # "+0.2% 🅑 11 Ⓢ 11"

            m2 = _PHANES_1H_LINE_RE.search(v)

            if m2:

                chg_1h_pct = float(m2.group("chg"))

                buys_1h = int(m2.group("buys"))

                sells_1h = int(m2.group("sells"))

        elif k == "ATH":

            # "$8.29M (-57% / 16d)"

            m2 = _PHANES_ATH_LINE_RE.search(v)

            if m2:

                ath_mcap_usd = parse_number_suffix(m2.group("ath"))

                ath_drawdown_pct = float(m2.group("dd"))

                ath_age_days = parse_age_to_days(m2.group("age"))



    socials_present = None

    m = _PHANES_SOCIALS_RE.search(text)

    if m:

        # e.g. "└ 𝕏 [♽] • TG • Web"

        line = m.group("line")

        # keep simple booleans based on tokens present

        tokens = []

        if "𝕏" in line or "X" in line:

            tokens.append("X")

        if "TG" in line:

            tokens.append("TG")

        if "Web" in line:

            tokens.append("Web")

        socials_present = tokens or None



    card = PhanesCard(

        bot="phanes",

        token_name=token_name,

        ticker=ticker,

        chain=chain,

        platform=platform,

        mint=mint,

        views=views,

        age_days=age_days,

        price_usd=price_usd,

        mcap_usd=mcap_usd,

        vol_usd=vol_usd,

        liquidity_usd=liquidity_usd,

        chg_1h_pct=chg_1h_pct,

        buys_1h=buys_1h,

        sells_1h=sells_1h,

        ath_mcap_usd=ath_mcap_usd,

        ath_drawdown_pct=ath_drawdown_pct,

        ath_age_days=ath_age_days,

        socials_present=socials_present,

        raw_text=text,

    )

    return asdict(card)





def parse_any_bot_card(text: str) -> Optional[Dict[str, Any]]:

    """

    Try Rick first (richer structured fields), then Phanes.

    """

    r = parse_rick_card(text)

    if r:

        return r

    p = parse_phanes_card(text)

    if p:

        return p

    return None

