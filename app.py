import streamlit as st
import requests, datetime, os, urllib.parse
import pandas as pd

# ================= BLR -> AMS FARE TRACKER =================
# Hosted on Streamlit Community Cloud - shareable with anyone.
# Prices: live Google Flights data via SerpAPI, cached 24h.
# NOTE: this file intentionally uses plain ASCII only (no emoji,
# no currency symbols) so copy/pasting it through mobile editors
# never corrupts a character.
# ===========================================================

SERPAPI_KEY = st.secrets["SERPAPI_KEY"]

ORIGIN, DEST = "BLR", "AMS"
CARRIERS = {"EY": "Etihad Airways", "AF": "Air France", "LH": "Lufthansa"}
DEPART_DATES = ["2026-08-14", "2026-08-15"]  # overnight flights land the 15th
RETURN_DATE = "2026-09-05"
ARRIVE_CUTOFF = "13:00"                      # land AMS by early afternoon 15 Aug
STUDENT_DISCOUNT = {"EY": 0.10, "AF": 0.08, "LH": 0.10}
HISTORY_FILE = "fare_history.csv"

# Published checked-baggage allowance, standard Economy, India -> Europe.
# Google Flights doesn't return exact kg, so these come from each airline's
# own fare-rules pages (linked below) rather than the live search.
BAGGAGE_STANDARD_KG = {"EY": 30, "AF": 23, "LH": 23}   # 1 bag, standard economy
BAGGAGE_STUDENT_KG =  {"EY": 30, "AF": 46, "LH": 46}   # student fare (2 bags where offered)
BAGGAGE_POLICY_PAGE = {
    "EY": "https://www.etihad.com/en/fly-etihad/baggage",
    "AF": "https://wwws.airfrance.co.in/information/bagages/franchise-bagages",
    "LH": "https://www.lufthansa.com/in/en/baggage",
}

AIRLINE_SITE = {
    "EY": "https://www.etihad.com/en-in/book",
    "AF": "https://wwws.airfrance.co.in/",
    "LH": "https://www.lufthansa.com/in/en/flight-search",
}
STUDENT_PAGE = {
    "EY": "https://www.etihad.com/en/offers/student-offers",
    "AF": "https://wwws.airfrance.co.in/information/tarifs/etudiants",
    "LH": "https://www.lufthansa.com/in/en/local-page/student-fares",
}

def inr(n):
    return "Rs. " + format(round(n), ",d")

def gflights_link(airline_name, date, return_date=None):
    q = f"Flights from {ORIGIN} to {DEST} on {date}"
    q += f" return {return_date}" if return_date else " one way"
    q += f" with {airline_name}"
    return "https://www.google.com/travel/flights?q=" + urllib.parse.quote(q)

st.set_page_config(page_title="BLR to AMS live fares", page_icon=":airplane:", layout="wide")

# ---------------- FETCH ----------------
def serp_search(outbound, ret=None):
    params = {
        "engine": "google_flights",
        "departure_id": ORIGIN, "arrival_id": DEST,
        "outbound_date": outbound,
        "currency": "INR", "hl": "en",
        "include_airlines": ",".join(CARRIERS.keys()),
        "api_key": SERPAPI_KEY,
        "type": 1 if ret else 2,
    }
    if ret:
        params["return_date"] = ret
    r = requests.get("https://serpapi.com/search", params=params, timeout=60)
    r.raise_for_status()
    j = r.json()
    return (j.get("best_flights") or []) + (j.get("other_flights") or [])

@st.cache_data(ttl=86400)  # one fresh pull per day - shared by all visitors
def fetch_all(today):
    oneway, rtn = [], []
    for d in DEPART_DATES:
        for f in serp_search(d):
            f["_depart"] = d
            oneway.append(f)
        for f in serp_search(d, RETURN_DATE):
            f["_depart"] = d
            rtn.append(f)
    return oneway, rtn

def best_per_airline(offers, morning_filter):
    best = {}
    for o in offers:
        try:
            legs = o["flights"]
            first_airline = legs[0].get("airline", "")
            code = next((c for c, n in CARRIERS.items()
                         if n.lower().split()[0] in first_airline.lower()), None)
            if not code:
                continue
            arr_time = legs[-1]["arrival_airport"].get("time", "")
            if morning_filter:
                if "2026-08-15" not in arr_time:
                    continue
                if arr_time.split(" ")[-1][:5] > ARRIVE_CUTOFF:
                    continue
            price = o.get("price")
            if price is None:
                continue
            stops = len(legs) - 1
            dur = o.get("total_duration", 0)
            # live layover airports, straight from Google Flights
            layovers = o.get("layovers", []) or []
            if layovers:
                stop_text = " + ".join(
                    f'{lv.get("name","")} ({lv.get("id","")})' for lv in layovers
                )
            elif stops == 0:
                stop_text = "Nonstop"
            else:
                mid = [legs[i]["arrival_airport"] for i in range(len(legs) - 1)]
                stop_text = " + ".join(
                    f'{m.get("name","")} ({m.get("id","")})' for m in mid
                ) or f"{stops} stop"
            if code not in best or price < best[code]["price"]:
                best[code] = {
                    "code": code, "airline": CARRIERS[code],
                    "price": price, "arrives": arr_time,
                    "stops": stops, "stop_text": stop_text,
                    "duration": f"{dur//60}h {dur%60:02d}m",
                    "depart": o["_depart"],
                }
        except Exception:
            continue
    return best

# ---------------- UI ----------------
st.title("BLR -> AMS  |  land by morning, 15 Aug 2026")
st.caption("Live Google Flights prices  |  Etihad / Air France / Lufthansa  |  "
           f"adult return {RETURN_DATE}  |  auto-refreshes daily  |  INR")

today = datetime.date.today().isoformat()
try:
    oneway_raw, return_raw = fetch_all(today)
except Exception as e:
    st.error(f"Fare lookup failed: {e}. The SerpAPI key may be missing from "
             "app secrets, or the monthly quota is used up.")
    st.stop()

ow = best_per_airline(oneway_raw, morning_filter=True)
rt = best_per_airline(return_raw, morning_filter=True)

rows = ([{"date": today, "airline": v["airline"], "type": "one-way", "price": v["price"]} for v in ow.values()]
      + [{"date": today, "airline": v["airline"], "type": "return", "price": v["price"]} for v in rt.values()])
if rows:
    hist = pd.DataFrame(rows)
    if os.path.exists(HISTORY_FILE):
        old = pd.read_csv(HISTORY_FILE)
        hist = pd.concat([old[old["date"] != today], hist])
    hist.to_csv(HISTORY_FILE, index=False)

def render(offers, is_student):
    if not offers:
        st.warning("No fares matched the morning-arrival filter today. "
                   "Widen ARRIVE_CUTOFF in the code if this keeps happening.")
        return
    for code, v in sorted(offers.items(), key=lambda kv: kv[1]["price"]):
        bag_kg = BAGGAGE_STUDENT_KG[code] if is_student else BAGGAGE_STANDARD_KG[code]
        with st.container(border=True):
            c1, c2, c3, c4 = st.columns([2, 2, 2, 2])
            c1.metric(v["airline"], inr(v["price"]))
            if is_student:
                est = v["price"] * (1 - STUDENT_DISCOUNT[code])
                c2.metric("Est. student fare", inr(est),
                          f'-{int(STUDENT_DISCOUNT[code]*100)}%')
            else:
                c2.metric("Trip", f'out {v["depart"][5:]} - back {RETURN_DATE[5:]}')
            c3.metric("Lands AMS", v["arrives"][5:16] if v["arrives"] else "-")
            c4.metric("Max checked baggage", f'{bag_kg} kg')

            st.markdown(f'**Stop:** {v["stop_text"]}   **Duration:** {v["duration"]}')

            l1, l2, l3, l4 = st.columns(4)
            l1.link_button("See on Google Flights",
                           gflights_link(v["airline"], v["depart"],
                                         None if is_student else RETURN_DATE))
            l2.link_button(f"Book on {v['airline'].split()[0]}.com",
                           AIRLINE_SITE[code])
            l3.link_button("Baggage policy", BAGGAGE_POLICY_PAGE[code])
            if is_student:
                l4.link_button("Student page", STUDENT_PAGE[code])

tab1, tab2, tab3 = st.tabs(["Student - one-way", "Adult - return", "Price history"])

with tab1:
    render(ow, is_student=True)
    st.info("Price and stop airport are live from Google Flights. Baggage "
            "weight isn't part of that live data - it's each airline's "
            "published Economy allowance (tap 'Baggage policy' to verify). "
            "True student prices also unlock only on the airline's own "
            "student page after ID verification, so that column is an "
            "estimate. Air France and Lufthansa student fares typically add "
            "a second 23 kg bag (46 kg total) - the max-baggage picks.")

with tab2:
    render(rt, is_student=False)

with tab3:
    if os.path.exists(HISTORY_FILE):
        h = pd.read_csv(HISTORY_FILE)
        for t in ["one-way", "return"]:
            sub = h[h["type"] == t]
            if len(sub):
                st.subheader(f"{t.title()} fares over time")
                st.line_chart(sub.pivot_table(index="date", columns="airline", values="price"))
        st.caption("One snapshot saved per day whenever anyone opens the app. "
                   "Note: the history resets if the app is redeployed.")
    else:
        st.info("History starts saving from today.")

if st.button("Force refresh now"):
    fetch_all.clear()
    st.rerun()

st.caption("Prices reflect what Google Flights displays for these airlines; "
           "the airline's own checkout is the final word - every card links "
           "straight to it.")
