"""Keyword-rule intent baseline (the "simple system" the learned classifier must beat).

Written from the label definitions in data/phrases/LABELING_GUIDE.md, the way a support team would
configure a rules-based router. Text is lower-cased and accent-stripped, then labels are checked in a
fixed priority order; the first label with a matching keyword wins. No match -> out_of_scope.
It has no confidence score, so it can never decide to ask a clarifying question.

Bias to disclose: the same author wrote these keywords and the test phrases, which favors the baseline.
v2 added keywords from the batch-2 TRAINING phrases only (never validation or test), so the baseline gets the
same extra data the learned model gets.
"""
import unicodedata

# Checked top to bottom: explicit requests (human, move money) before dispute and status wording.
RULES: list[tuple[str, list[str]]] = [
    ("human_agent", [
        # v2 (2026-09-28): extended from the batch-2 training phrases, like a team updating its rules
        "videollamada", "videochamada", "gerente", "responsable", "responsavel", "devolver la llamada", "retornar a ligacao", "area de fraudes", "setor de fraude", "ingles", "operador", "otra persona", "outra pessoa", "una persona", "uma pessoa", "cita", "turno", "agendar", "correo", "e-mail", "mail", "justicia", "justica", "no me entiende", "nao me entende",
        "hablar con", "falar com", "pasame con", "me passa", "comunica", "asesor", "supervisor", "agente",
        "ejecutivo", "executivo", "humano", "atendente", "robot", "robo", "bot", "llamar", "llamen",
        "llamada", "ligar", "me liga", "ligacao", "call center", "central", "carne y hueso", "carne e osso",
        "me atienda", "atendido", "atendimento", "escalar",
    ]),
    ("move_money", [
        # v2 (2026-09-28): extended from the batch-2 training phrases, like a team updating its rules
        "cambiame", "troca ", "comprame", "compra dolar", "liquida", "quita ", "recargame", "recarga", "poneme", "coloca ", "detengan", "frenen", "parem ", "segura ", "pasa ", "passa ", "meteme", "invertir", "aplicar", "generame", "gera ", "haceme un codigo", "faz um codigo", "cancela la", "cancela a", "cancelar pago", "cancelar pagamento", "cancelar prestamo", "anula", "reintegr", "reembolsem", "paga ahora", "paga agora", "paga el minimo", "paga o minimo", "pagar minimo", "quitar",
        "devuelvan", "devuelveme", "devolvam", "devolve ", "regresen", "regresame", "reembols", "reversen",
        "reversar", "estornem", "estornar", "transfiere", "transfere ", "transferir ", "mandale", "manda ",
        "depositen", "depositem", "depositar", "acredit", "contracargo", "chargeback", "liberen", "liberem",
        "liberar", "paga mi", "pagame", "pagale", "paga meu", "paga minha", "paga a fatura", "pagar tarjeta",
        "pagar internet", "pagar fatura", "compensac", "adelanto", "adiantamento", "avance",
    ]),
    ("unrecognized_charge", [
        # v2 (2026-09-28): extended from the batch-2 training phrases, like a team updating its rules
        "hackearon", "hackearam", "nunca autorice", "nunca autorizei", "jamas autorice", "no son mios", "no es mio", "nunca he usado", "nunca usei", "ni conozco", "nem conheco", "nunca recibi", "nunca recebi", "ni me llego", "nem chegou", "golpe", "estafa", "robo", "roubo", "cuento del tio", "clonacion", "chip clonado", "no tome", "nao peguei", "ni juego", "nem jogo", "no reconocido",
        "no reconoz", "nao reconhec", "desconoc", "desconhec", "no hice", "nao fiz", "yo no fui",
        "nao fui eu", "clonaron", "clonaram", "no autoric", "nao autoriz", "no es mia", "nao e minha",
        "no son mias", "nao sao minhas", "ni idea", "no compre", "nao comprei", "nunca he estado",
        "nunca estive", "no autorizada", "nao autorizada",
    ]),
    ("wrongful_fee", [
        # v2 (2026-09-28): extended from the batch-2 training phrases, like a team updating its rules
        "descuento", "desconto", "todo junto", "tudo junto", "de una vez", "de uma vez", "sobregiro", "cheque especial", "noche de mas", "noche extra", "diaria a mais", "diaria extra", "reposicion", "segunda via", "dio menos", "entrego", "entregou", "soltou", "moneda equivocada", "moeda errada", "sin avisar", "sem avisar", "penalizacion", "multa",
        "dos veces", "duas vezes", "duplicad", "doble", "em dobro", "comision", "tarifa", "anualidad",
        "anuidade", "cuota de manejo", "intereses por mora", "intereses de mora", "juros", "indebid",
        "indevid", "de mas", "a mais", "mas de lo que", "cobrada errado", "cobrado mal", "seguro que",
        "siguen cobrando", "continuam", "mora",
    ]),
    ("transaction_status", [
        # v2 (2026-09-28): extended from the batch-2 training phrases, like a team updating its rules
        "cheque", "rejeitada", "devolvida", "volvio", "voltou", "qr", "no se realizo", "nao foi feito", "no salio", "nao saiu", "bloqueada por", "bloquearon la compra", "bloquearam", "reclamo", "contestacao", "verificacion", "em analise", "aprobaron", "aprovaram", "limite excedido", "supere el limite", "passei do limite", "se acredita", "quando cai", "no la veo",
        "rechaz", "recusad", "pendiente", "pendente", "no llega", "nao chegou", "no le llego", "todavia no",
        "ainda nao", "se aplico", "processad", "reversad", "estornad", "devolucion", "estorno", "retenido",
        "retido", "error", "erro", "estado de", "status", "cuanto tarda", "quanto tempo", "no aparece",
        "nao aparece", "caiu", "entrou", "no me deja", "nao consigo comprar", "en proceso", "em processamento",
    ]),
    ("balance_check", [
        # v2 (2026-09-28): extended from the batch-2 training phrases, like a team updating its rules
        "cierra", "corte", "fechamento", "fecha a fatura", "invertido", "aplicado", "cdt", "aplicacao", "ultimo deposito", "extracto", "extrato", "cuanto he pagado", "quanto ja paguei", "total de tarifas", "total comisiones", "cuotas", "parcelas", "consultar", "tasa de interes", "taxa de juros", "disponible", "disponivel", "contable",
        "saldo", "cuanto tengo", "quanto tenho", "cuanto debo", "quanto devo", "cuanto le debo", "cupo",
        "limite disponivel", "movimientos", "movimentac", "pago minimo", "pagamento minimo", "balance",
        "resumen", "resumo", "gastado", "gastei", "intereses", "rendeu", "rendimento", "cuantos dolares",
        "quantos dolares", "cuanto me falta", "quanto falta", "fatura", "cuanta plata", "quanto dinheiro",
        "gastar",
    ]),
]
DEFAULT = "out_of_scope"


def normalize(text: str) -> str:
    stripped = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return " " + " ".join(stripped.lower().split()) + " "


def predict(text: str) -> str:
    t = normalize(text)
    for label, keywords in RULES:
        if any(k in t for k in keywords):
            return label
    return DEFAULT
