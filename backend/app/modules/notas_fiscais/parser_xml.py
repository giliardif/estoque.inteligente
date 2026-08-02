"""
Parser de XML de NF-e.

RISCO DE SEGURANÇA: parsing de XML vindo de fora é vetor clássico de:
  - XXE (XML External Entity) — leitura de arquivos locais do servidor
  - Bilhão de risadas (billion laughs) — DoS por expansão de entidades
  - SSRF via DTD externo

Mitigação: usar defusedxml em vez de xml.etree padrão. NUNCA trocar por
lxml.etree ou xml.etree.ElementTree "cru" sem resolver_entities=False.
"""
from dataclasses import dataclass

from defusedxml.ElementTree import ParseError, fromstring
from fastapi import HTTPException, UploadFile, status

MAX_XML_SIZE_BYTES = 5 * 1024 * 1024  # 5MB — nota fiscal legítima é sempre pequena
NFE_NAMESPACE = "{http://www.portalfiscal.inf.br/nfe}"


@dataclass
class ItemNota:
    descricao: str
    codigo_ean: str | None
    quantidade: float
    valor_unitario: float


@dataclass
class NotaFiscalParseada:
    numero: str
    fornecedor_nome: str
    fornecedor_documento: str
    itens: list[ItemNota]


async def parse_nfe_xml(arquivo: UploadFile) -> NotaFiscalParseada:
    conteudo = await arquivo.read()

    if len(conteudo) > MAX_XML_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Arquivo XML excede o tamanho máximo permitido (5MB).",
        )

    if arquivo.content_type not in ("text/xml", "application/xml"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Envie um arquivo XML válido de NF-e.",
        )

    try:
        # defusedxml.fromstring já desabilita DTD, entidades externas e expansão de entidades
        root = fromstring(conteudo)
    except ParseError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="XML inválido ou malformado.")
    except Exception:
        # Qualquer outra falha de parsing tratada como entrada inválida — nunca vazar stacktrace
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Não foi possível processar o XML.")

    try:
        numero = _texto(root, ".//{ns}ide/{ns}nNF")
        fornecedor_nome = _texto(root, ".//{ns}emit/{ns}xNome")
        fornecedor_documento = _texto(root, ".//{ns}emit/{ns}CNPJ")

        itens = []
        for det in root.findall(f".//{NFE_NAMESPACE}det"):
            prod = det.find(f"{NFE_NAMESPACE}prod")
            if prod is None:
                continue
            itens.append(
                ItemNota(
                    descricao=_campo(prod, "xProd"),
                    codigo_ean=_campo(prod, "cEAN"),
                    quantidade=float(_campo(prod, "qCom") or 0),
                    valor_unitario=float(_campo(prod, "vUnCom") or 0),
                )
            )
    except (AttributeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Estrutura do XML não corresponde ao layout esperado de NF-e.",
        )

    if not itens:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nenhum item encontrado na nota.")

    return NotaFiscalParseada(
        numero=numero, fornecedor_nome=fornecedor_nome,
        fornecedor_documento=fornecedor_documento, itens=itens,
    )


def _texto(root, path_template: str) -> str:
    el = root.find(path_template.replace("{ns}", NFE_NAMESPACE))
    if el is None or not el.text:
        raise AttributeError(f"Campo obrigatório ausente: {path_template}")
    return el.text.strip()


def _campo(prod_el, tag: str) -> str | None:
    el = prod_el.find(f"{NFE_NAMESPACE}{tag}")
    return el.text.strip() if el is not None and el.text else None
