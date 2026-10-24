"""Crea una vista parziale del diagramma v3: gli elementi del flusso restano pieni, il resto si sbiadisce.

Uso: python3 vista.py <nome-vista> <out.drawio>
Le viste sono definite in VISTE qui sotto, con gli id delle celle di real-estate-v3.drawio.
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SORGENTE = Path(__file__).resolve().parents[2] / "definitivo/diagrammi/real-estate-v3.drawio"

# Contenitori che danno il contesto: restano visibili se contengono qualcosa del flusso.
CONTENITORI = {"account", "global", "region", "a_front", "a_auth", "a_notif", "a_support", "vpc",
               "sg_ep_sns", "sg_lambda", "sg_proxy", "sg_ep_sm", "az1", "subA", "sg_rds_a",
               "az2", "subB", "sg_rds_b", "cluster", "legend"}

VISTE = {
    "spa": {"user", "cf_site", "s3_site", "e1", "e2"},
    "api": {
        "user", "cognito", "apigw", "e3", "e4", "e5", "e6",
        "l_files", "l_presigned", "l_property", "l_users", "l_offers",
        "role_files", "role_presigned", "role_property", "role_users", "role_offers",
    },
    "database": {
        "l_files", "l_presigned", "l_property", "l_users", "l_offers",
        "role_files", "role_presigned", "role_property", "role_users", "role_offers",
        "proxy", "proxy_role", "ep_sm", "secrets", "writer", "reader", "cluster", "e7", "e8a", "e8b", "e9a", "e9b",
    },
    "file": {
        "user", "apigw", "s3_files", "cf_files", "l_presigned", "l_files", "l_property",
        "role_presigned", "role_files", "role_property", "ep_s3", "ep_s3_note",
        "e4", "e6", "e14", "e15", "e16a", "e16b", "e17a", "e17b", "e21",
    },
    "account": {
        "user", "cognito", "apigw", "l_users", "role_users", "proxy", "writer",
        "e3", "e4", "e6", "e7", "e8a",
    },
    "osservabilita": {
        "apigw", "cloudwatch", "l_files", "l_presigned", "l_property", "l_users", "l_offers", "mailer",
        "dlq", "alarm", "sns_ops", "team", "e18a", "e18b", "e19a", "e19b", "e19c",
    },
    "rete": {
        "l_files", "l_presigned", "l_property", "l_users", "l_offers", "proxy", "ep_sm", "ep_sns", "ep_s3",
        "ep_s3_note", "vpc_note", "writer", "reader", "cluster", "e7", "e8a", "e8b", "e9a", "e10a", "e16a", "e21",
    },
    "notifiche": {
        "user", "cognito", "l_property", "l_users", "l_offers", "role_property", "role_users", "role_offers",
        "ep_sns", "sns", "sqs", "dlq", "mailer", "mailer_role", "ses", "alarm", "sns_ops", "team",
        "lbl_maxrecv", "lbl_redrive", "mailer_note",
        "e10a", "e10b", "e11a", "e11b", "e11c", "e12", "e13a", "e13b", "e19a", "e19b", "e19c", "e20",
    },
}

SBIADITO = "opacity=12;textOpacity=12;"


def genitori(celle):
    return {c.get("id"): c.get("parent") for c in celle}


def main(nome, out):
    fuoco = VISTE[nome]
    albero = ET.parse(SORGENTE)
    celle = list(albero.getroot().iter("mxCell"))
    padre = genitori(celle)
    # un contenitore resta pieno se un elemento del flusso sta dentro di lui
    contenitori_vivi = set()
    for cid in fuoco:
        p = padre.get(cid)
        while p:
            contenitori_vivi.add(p)
            p = padre.get(p)
    for c in celle:
        cid = c.get("id")
        if cid in ("0", "1") or cid in fuoco or cid in contenitori_vivi:
            continue
        if cid in CONTENITORI and cid != "legend":
            c.set("style", SBIADITO + (c.get("style") or ""))
            continue
        if cid in CONTENITORI or padre.get(cid) == "legend":
            continue
        c.set("style", SBIADITO + (c.get("style") or ""))
    albero.write(out, encoding="utf-8", xml_declaration=False)
    print(" ".join(str(v) for v in ritaglio(celle, padre, fuoco)))


def ritaglio(celle, padre, fuoco, scala=2, bordo=20, margine=40):
    """Rettangolo x y w h, in pixel del render, che contiene gli elementi del flusso."""
    geo = {}
    for c in celle:
        g = c.find("mxGeometry")
        if g is not None and c.get("vertex"):
            geo[c.get("id")] = tuple(float(g.get(k, 0)) for k in ("x", "y", "width", "height"))
    def assoluto(cid):
        x, y, w, h = geo[cid]
        q = padre.get(cid)
        while q in geo:
            x += geo[q][0]; y += geo[q][1]; q = padre.get(q)
        return x, y, w, h
    def punti(c):
        g = c.find("mxGeometry")
        return [(float(pt.get("x", 0)), float(pt.get("y", 0))) for pt in g.iter("mxPoint")] if g is not None else []
    tutti = [assoluto(i) for i in geo]
    xs = [x for x, y, w, h in tutti] + [x for c in celle if c.get("edge") for x, _ in punti(c)]
    ys = [y for x, y, w, h in tutti] + [y for c in celle if c.get("edge") for _, y in punti(c)]
    minx, miny = min(xs), min(ys)
    box = []
    for c in celle:
        cid = c.get("id")
        if cid not in fuoco:
            continue
        if cid in geo:
            x, y, w, h = assoluto(cid)
            box += [(x - 30, y - 10), (x + w + 30, y + h + 45)]
        elif c.get("edge"):
            box += punti(c)
    x0 = min(x for x, _ in box); y0 = min(y for _, y in box)
    x1 = max(x for x, _ in box); y1 = max(y for _, y in box)
    px = lambda v, m: int((v - m + bordo) * scala)
    X0, Y0 = max(0, px(x0, minx) - margine), max(0, px(y0, miny) - margine)
    return X0, Y0, px(x1, minx) + margine - X0, px(y1, miny) + margine - Y0


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
