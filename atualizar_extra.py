#!/usr/bin/env python3
"""Atualiza extra.json, os dados dos blocos "Preço eficiente" e "Marca mais barata"
da página /precos-combustiveis.

1. Preço médio por marca: API pública da DGEG (precoscombustiveis.dgeg.gov.pt),
   média simples dos preços afixados por posto, marcas com 20 ou mais postos.
   Com LF_SEM_DGEG=1 no ambiente este passo é saltado e ficam os valores anteriores.
2. Preço eficiente: relatório semanal da ERSE (PDF). Lê o PDF mais recente da página
   de supervisão de preços, incluindo a comparação com os preços da semana anterior.
   Se a leitura falhar ou os números não baterem certo, mantém o que já estava no ficheiro.

Dependências: pypdf e cryptography (pip install pypdf cryptography).

Uso normal:          python3 atualizar_extra.py
Teste com um PDF:    python3 atualizar_extra.py --pdf relatorio.pdf   (não chama a DGEG nem escreve o ficheiro)
"""
import io, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import date, timedelta

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extra.json")
UA = {"User-Agent": "Mozilla/5.0 (compatible; LF-combustiveis/1.0; +https://www.literaciafinanceira.pt)"}
DGEG = ("https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PesquisarPostos?idsTiposComb={id}"
        "&idMarca=&idTipoPosto=&idDistrito=&idsMunicipios=&qtdPorPagina=6000&pagina=1")
ERSE_LISTA = "https://www.erse.pt/combustiveis-e-gpl/supervisao-do-mercado/supervisao-dos-precos-de-combustiveis/"
MIN_POSTOS = 20
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]


def get(url, tentativas=3):
    """Descarrega o URL. Erros de rede passageiros (timeout, 429, 5xx) têm mais duas tentativas."""
    partes = urllib.parse.urlsplit(url)
    url = urllib.parse.urlunsplit(partes._replace(path=urllib.parse.quote(partes.path, safe="/%")))
    for i in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if (e.code < 500 and e.code != 429) or i == tentativas - 1:
                raise RuntimeError("HTTP %s ao abrir %s" % (e.code, url)) from e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if i == tentativas - 1:
                raise RuntimeError("%s ao abrir %s: %s" % (type(e).__name__, url, e)) from e
        time.sleep(15 * (i + 1))


def marcas(id_comb):
    dados = json.loads(get(DGEG.format(id=id_comb)).decode("utf-8-sig"))
    por_marca, todos = {}, []
    for p in dados.get("resultado") or []:
        try:
            preco = float(str(p["Preco"]).replace("€", "").replace(",", ".").strip())
        except (ValueError, KeyError):
            continue
        if not 0.5 < preco < 4:
            continue
        todos.append(preco)
        por_marca.setdefault((p.get("Marca") or "").strip(), []).append(preco)
    if len(todos) < 1000:
        raise RuntimeError(f"DGEG devolveu só {len(todos)} postos para {id_comb}")
    lista = sorted(([m, len(v), round(sum(v) / len(v), 4)] for m, v in por_marca.items() if m and len(v) >= MIN_POSTOS),
                   key=lambda x: x[2])
    return {"media": round(sum(todos) / len(todos), 4), "postos": len(todos), "lista": lista}


def n(s):
    return float(s.replace("−", "-").replace("–", "-").replace("+", "").replace(",", "."))


def semana_txt(a, b):
    """'21 a 27 de setembro' ou '31 de agosto a 6 de setembro'."""
    if a.month == b.month:
        return f"{a.day} a {b.day} de {MESES[b.month - 1]}"
    return f"{a.day} de {MESES[a.month - 1]} a {b.day} de {MESES[b.month - 1]}"


class Ilegivel(Exception):
    """O relatório da ERSE abriu, mas o texto não tem o formato esperado. A mensagem diz o que faltou."""


def excerto(txt, marca, antes=40, depois=200):
    """Bocado do texto à volta de `marca`, para a mensagem de erro mostrar o que o PDF diz de facto."""
    k = txt.find(marca)
    return txt[max(k - antes, 0):k + depois] if k > -1 else txt[:depois]


def frase(texto):
    """Regex de uma frase do relatório com os espaços opcionais. O pypdf às vezes come espaços entre palavras
    (no relatório de 12 a 18 de outubro de 2026 saiu "gasolina 95 simplese de 1,359")."""
    return r"\s*".join(re.escape(p) for p in texto.split())


def achar(txt, texto, inicio=0):
    """Como txt.find(texto, inicio), mas tolerante a espaços comidos."""
    m = re.compile(frase(texto)).search(txt, inicio)
    return m.start() if m else -1


def ler_relatorio(pdf_bytes):
    """Extrai os números do relatório semanal da ERSE. Levanta uma exceção a explicar o que falhou."""
    from pypdf import PdfReader
    try:
        txt = " ".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(pdf_bytes)).pages)
    except Exception as e:
        raise RuntimeError("o pypdf não conseguiu abrir o PDF (%s: %s)" % (type(e).__name__, e)) from e
    if len(txt.strip()) < 200:
        raise Ilegivel("o PDF não tem texto que se consiga extrair (%d caracteres)" % len(txt.strip()))
    return ler_texto(txt)


def ler_texto(txt):
    txt = re.sub(r"\s+", " ", txt)
    txt = re.sub(r"\s*-\s*se\b", "-se", txt)  # "situa -se" -> "situa-se"

    # Datas da semana (capa): "21-setembro -2026 a 27- setembro -2026"
    m = re.search(r"(\d{1,2})\s*-\s*([a-zç]+)\s*-\s*(\d{4})\s*a\s*(\d{1,2})\s*-\s*([a-zç]+)\s*-\s*(\d{4})", txt, re.I)
    if not m or m.group(2).lower() not in MESES or m.group(5).lower() not in MESES:
        raise Ilegivel("não encontrei as datas da semana na capa. Início do texto: «%s»" % txt[:160])
    ini = date(int(m.group(3)), MESES.index(m.group(2).lower()) + 1, int(m.group(1)))
    fim = date(int(m.group(6)), MESES.index(m.group(5).lower()) + 1, int(m.group(4)))
    if (fim - ini).days != 6:
        raise Ilegivel("as datas da capa não fazem uma semana: %s a %s" % (ini, fim))

    eur = r"\s*€\s*/\s*l\s*"
    a = re.search(frase("antes de impostos é de") + r"\s*(\d,\d{3})" + eur + frase("para a gasolina 95 simples e de")
                  + r"\s*(\d,\d{3})" + eur + frase("para o gasóleo"), txt)
    b = re.search(frase("situa-se em") + r"\s*(\d,\d{3})" + eur + frase("na gasolina 95 simples e em")
                  + r"\s*(\d,\d{3})" + eur + frase("no gasóleo"), txt)
    if not a:
        raise Ilegivel("não encontrei a frase do Preço Eficiente antes de impostos: «%s»" % excerto(txt, "antes de impostos"))
    if not b:
        raise Ilegivel("não encontrei a frase do Preço Eficiente com impostos: «%s»" % excerto(txt, "situa-se em"))
    out = {"semana": semana_txt(ini, fim), "inicio": ini.isoformat(),
           "gasolina": {"pvp": n(b.group(1)), "semImpostos": n(a.group(1))},
           "gasoleo": {"pvp": n(b.group(2)), "semImpostos": n(a.group(2))}}
    for f in ("gasolina", "gasoleo"):
        if not (1 < out[f]["pvp"] < 4 and 0.3 < out[f]["semImpostos"] < out[f]["pvp"]):
            raise Ilegivel("valores fora do intervalo plausível em %s: %s" % (f, out[f]))

    # Variação face à semana anterior: "aumentou 1,0% na gasolina e 3,1% no gasóleo", "diminuiu ...", ou um de cada
    v = re.search(frase("Face à semana anterior, o Preço Eficiente") + r"\s*(.{0,160}?" + frase("no gasóleo") + ")", txt)
    if v:
        s = v.group(1)

        def variacao(alvo, inicio, herdado):
            """Percentagem antes de 'na gasolina' ou 'no gasóleo', com o sinal do verbo mais próximo antes dela.
            Sem verbo próprio ("aumentou 1,0% na gasolina e 3,1% no gasóleo") herda o do combustível anterior."""
            m = re.search(r"(\d+,\d+)\s*%\s*" + frase(alvo), s[inicio:])  # "2,2%" ou "0,08%"
            if not m:
                return None, herdado, inicio
            verbos = re.findall(r"aument\w+|diminu\w+|desceu|subiu|reduziu", s[inicio:inicio + m.start()])
            verbo = verbos[-1] if verbos else herdado
            sinal = -1 if re.match(r"diminu|desceu|reduziu", verbo or "") else 1
            return sinal * n(m.group(1)), verbo, inicio + m.end()

        g, verbo, fim_g = variacao("na gasolina", 0, "")
        d, _, _ = variacao("no gasóleo", fim_g, verbo)
        if g is not None:
            out["gasolina"]["variacaoPct"] = g
        if d is not None:
            out["gasoleo"]["variacaoPct"] = d

    # Comparação com os preços praticados na semana anterior ("A comparação com os preços praticados no mercado...")
    def par(trecho):
        c = re.findall(r"(\d+,\d+)\s*cênt", trecho)
        p = re.findall(r"([+\-−–]?\s*\d+,\d+)\s*%", trecho)  # "-2,2%" ou "+0,04%"
        if len(c) < 2 or len(p) < 2:
            return None
        res = []
        for cent, pc in zip(c[:2], p[:2]):
            pc = n(pc.replace(" ", ""))
            res.append((round((-1 if pc < 0 else 1) * n(cent), 1), pc))
        return res
    i = achar(txt, "Preços com Descontos, publicados pela DGEG")
    j = achar(txt, "Quanto aos preços de pórtico")
    desc = par(txt[i:achar(txt, "respetivamente", i)]) if i > -1 else None
    port = par(txt[j:achar(txt, "respetivamente", j)]) if j > -1 else None
    if desc and port:
        ok = True
        for k, f in enumerate(("gasolina", "gasoleo")):
            for cent, pc in (desc[k], port[k]):
                # o desvio em % tem de ser coerente com os cêntimos (preço na ordem do preço eficiente)
                if abs(abs(cent) / out[f]["pvp"] - abs(pc)) > 0.6:
                    ok = False
        if ok:
            out["anterior"] = {"semana": semana_txt(ini - timedelta(days=7), fim - timedelta(days=7))}
            for k, f in enumerate(("gasolina", "gasoleo")):
                out["anterior"][f] = {"porticoCent": port[k][0], "porticoPct": port[k][1],
                                      "descontosCent": desc[k][0], "descontosPct": desc[k][1]}
    return out


def eficiente():
    html = get(ERSE_LISTA).decode("utf-8", errors="replace")
    m = re.search(r'href="([^"]+relat[^"]*semanal[^"]*\.pdf)"', html, re.I)
    if not m:
        raise Ilegivel("não encontrei o link do relatório semanal na página da ERSE")
    url = urllib.parse.urljoin(ERSE_LISTA, m.group(1))
    try:
        out = ler_relatorio(get(url))
    except Exception as e:
        raise RuntimeError("%s [%s]" % (e, url)) from e
    return {"semana": out.pop("semana"), "inicio": out.pop("inicio"), "fonte": url, **out}


def main():
    if "--pdf" in sys.argv:
        with open(sys.argv[sys.argv.index("--pdf") + 1], "rb") as f:
            try:
                print(json.dumps(ler_relatorio(f.read()), ensure_ascii=False, indent=1))
            except Exception as e:
                print("ERRO:", e, file=sys.stderr)
                sys.exit(1)
        return
    with open(OUT, encoding="utf-8") as f:
        dados = json.load(f)
    hoje = date.today().isoformat()
    erros = []
    if os.environ.get("LF_SEM_DGEG") == "1":
        print("Marcas: leitura da DGEG desligada (LF_SEM_DGEG=1), mantidos os valores anteriores")
    else:
        try:
            dados["marcas"] = {"data": hoje, "minPostos": MIN_POSTOS, "gasolina": marcas(3201), "gasoleo": marcas(2101)}
        except Exception as e:
            erros.append("Marcas: leitura da DGEG falhou, mantidos os valores anteriores: %s" % e)
    try:
        novo = eficiente()
        if novo["fonte"] != dados.get("eficiente", {}).get("fonte"):
            dados["eficiente"] = novo
            dados["eficiente_lido"] = hoje
            print("Preço eficiente atualizado:", novo["semana"], "(com comparação)" if "anterior" in novo else "(sem comparação)")
        else:
            print("Preço eficiente: sem relatório novo da ERSE (continua", novo["semana"] + ")")
    except Exception as e:  # o bloco da ERSE nunca deve impedir a atualização das marcas
        erros.append("Preço eficiente: %s. Ficam os valores anteriores." % e)
    # a ERSE publica um relatório por semana: mais de 16 dias sem um novo é sinal de que algo mudou
    lido = dados.setdefault("eficiente_lido", hoje)
    if (date.today() - date.fromisoformat(lido)).days > 16:
        erros.append("Preço eficiente: sem relatório novo da ERSE desde %s" % lido)
    dados["atualizado"] = hoje
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=1)
    print("Marcas:", len(dados["marcas"]["gasolina"]["lista"]), "gasolina,", len(dados["marcas"]["gasoleo"]["lista"]), "gasóleo")
    publicar("Atualiza preço eficiente e marcas (%s)" % hoje)
    if erros:  # falhar o workflow faz o GitHub enviar um email de aviso
        for e in erros:
            if os.environ.get("GITHUB_ACTIONS"):
                # "::error::" faz o erro aparecer como anotação no resumo do workflow, sem ser preciso abrir o log
                print("::error::" + e.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
            else:
                print("ERRO:", e, file=sys.stderr)
        sys.exit(1)


def publicar(mensagem):
    """Grava o extra.json no repositório quando corre no GitHub Actions."""
    if not os.environ.get("GITHUB_ACTIONS"):
        return
    raiz = os.path.dirname(os.path.abspath(OUT))
    git = lambda *a: subprocess.run(["git", "-C", raiz, *a], check=False)
    git("config", "user.name", "combustiveis-bot")
    git("config", "user.email", "bot@users.noreply.github.com")
    git("add", os.path.basename(OUT))
    if subprocess.run(["git", "-C", raiz, "diff", "--cached", "--quiet"]).returncode:
        git("commit", "-m", mensagem)
        git("pull", "--rebase")
        git("push")


if __name__ == "__main__":
    main()
