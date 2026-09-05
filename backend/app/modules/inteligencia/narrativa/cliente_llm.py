"""
Camada narrativa — chamada à API da Anthropic.

REGRA FÍSICA (não só convenção): este arquivo, e todo o pacote `narrativa/`,
NUNCA importa `app.core.database`, `sqlalchemy` ou qualquer sessão de banco.
A função abaixo recebe só `tipo: str` e `dados: dict` — já calculados pela
camada analista — e devolve texto. Se algum dia alguém tentar adicionar um
import de banco aqui, isso deve ser barrado no code review: é a quebra da
regra "a LLM nunca calcula, nunca consulta o estoque".
"""
import logging

import anthropic

from app.core.config import get_settings
from app.modules.inteligencia.narrativa.prompts import montar_prompt

logger = logging.getLogger(__name__)

# Haiku é suficiente e mais barato/rápido pra essa tarefa: narrar um dict
# pequeno já calculado não exige raciocínio profundo, só reescrita fluente —
# escolha deliberada pra manter o custo por insight baixo e previsível.
MODELO_NARRATIVA = "claude-haiku-4-5-20251001"
MAX_TOKENS_NARRATIVA = 300


class NarrativaIndisponivel(Exception):
    """Levantada quando a chamada à LLM falha — o chamador deve tratar isso
    como não-fatal (o insight já foi calculado e persistido; a narrativa
    pode ser tentada de novo na próxima análise)."""


def narrar_insight(tipo: str, dados: dict) -> str:
    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        raise NarrativaIndisponivel("ANTHROPIC_API_KEY não configurada neste ambiente.")

    prompt = montar_prompt(tipo, dados)
    cliente = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    try:
        resposta = cliente.messages.create(
            model=MODELO_NARRATIVA,
            max_tokens=MAX_TOKENS_NARRATIVA,
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIError as exc:
        logger.warning("Falha ao gerar narrativa (tipo=%s): %s", tipo, exc)
        raise NarrativaIndisponivel(str(exc)) from exc

    blocos_texto = [bloco.text for bloco in resposta.content if bloco.type == "text"]
    texto = "\n".join(blocos_texto).strip()
    if not texto:
        raise NarrativaIndisponivel("Resposta da LLM veio vazia.")
    return texto
