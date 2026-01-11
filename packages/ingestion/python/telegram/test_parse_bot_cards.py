import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))

from tools.telegram.parse_bot_cards import parse_any_bot_card, find_mint_addresses



RICK_SAMPLE = r"""

🟡 FROGE [3.6M/-17%] $$FROGE 🔼

🌐 Solana @ Meteora DYN2

💰 USD: $0.0035938

💎 FDV: $3.6M ⇨ 8.1M [16d]

💦 Liq: $97.7K [x37] ⋅ ‼️ 0%

📊 Vol: $63K ⋅ Age: 26d

📈 1H: 0.2% ⋅ $1K 🅑 12 Ⓢ 11

👥 TH: 2.7⋅1.9⋅1.8⋅1.7⋅1.6 [17%]

🤝 Total: 1.6K ⋅ avg 5w old

🌱 Fresh 1D: 2% ⋅ 7D: 2%

💹 Chart: DEX⋅DEF

🧰 More: 🫧 🎨 💪 💬 🌍 🐦 [♺]



2bNQko1C2wYfexfe9MBnd7SwwaQC6vyEXdhMkhBWEN4d

MAE⋅BAN⋅BNK⋅PDR⋅BLO⋅STB⋅PEP

"""



PHANES_SAMPLE = r"""

🟣 FROGE ($FROGE)

├ 2bNQko1C2wYfexfe9MBnd7SwwaQC6vyEXdhMkhBWEN4d

└ #SOL | 26d | 👁️6



📊 Stats

 ├ USD   $0.0036 (-17%)

 ├ MC    $3.59M

 ├ Vol   $62.6K

 ├ LP    $97.7K

 ├ 1H    +0.2% 🅑 11 Ⓢ 11

 └ ATH   $8.29M (-57% / 16d)



🔗 Socials

 └ 𝕏 [♽] • TG • Web

"""



def test_extract_mint():

    m = find_mint_addresses(RICK_SAMPLE)

    assert m and m[0].startswith("2bNQ")



def test_parse_rick():

    d = parse_any_bot_card(RICK_SAMPLE)

    assert d is not None

    assert d["bot"] == "rick"

    assert d["ticker"] == "FROGE"

    assert d["chain"].lower().startswith("sol")

    assert d["mint"].startswith("2bNQ")

    assert abs(d["mcap_usd"] - 3_600_000) < 1

    assert abs(d["mcap_change_pct"] - (-17.0)) < 1e-9

    assert abs(d["liquidity_usd"] - 97_700) < 1

    assert d["total_holders"] == 1600

    assert d["avg_wallet_age_days"] == 35



def test_parse_phanes():

    d = parse_any_bot_card(PHANES_SAMPLE)

    assert d is not None

    # Rick isn't present, so it should be phanes

    assert d["bot"] == "phanes"

    assert d["ticker"] == "FROGE"

    assert d["chain"] == "SOL"

    assert d["age_days"] == 26

    assert abs(d["mcap_usd"] - 3_590_000) < 1

    assert d["mint"].startswith("2bNQ")

