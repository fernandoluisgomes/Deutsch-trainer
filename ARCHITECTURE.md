# Deutsch Trainer v11 — Arquitetura

## Princípios

1. O scheduler escolhe **qual cartão** aparece; não conhece idiomas nem sentido.
2. `currentCard` contém os dados persistentes do cartão.
3. `currentTrainingContext` contém apenas a apresentação atual: pergunta, resposta, idiomas, respostas aceites e sentido.
4. O contexto é criado uma vez por carta e mantém-se até à carta seguinte.
5. A interface, TTS e reconhecimento de voz usam exclusivamente o `TrainingContext`.

## Idiomas

`LANGUAGE_REGISTRY` é a fonte central das capacidades de cada idioma:

- campo do cartão (`field`);
- locale de leitura (`ttsLocale`);
- locale de reconhecimento (`speechLocale`);
- suporte a artigos (`articleSupport`).

Na v11.0.0, o idioma base está bloqueado em Português (Portugal) e o idioma de aprendizagem em Alemão. Os seletores ficam visíveis para preparar a futura abertura a outros pares.

## Sentidos

- `NORMAL`: idioma base → idioma de aprendizagem;
- `REVERSE`: idioma de aprendizagem → idioma base;
- `MIXED`: sorteio independente 50/50 por nova apresentação.

## Compatibilidade

Os cartões continuam a usar os campos `pt` e `de`, garantindo compatibilidade com os JSON/CSV existentes. O acesso é indireto: `card[language.field]`.

## Voz

- TTS usa `questionLanguage.ttsLocale` ou `answerLanguage.ttsLocale`;
- reconhecimento usa `answerLanguage.speechLocale`;
- regras de artigos só são aplicadas quando `answerLanguage.articleSupport` é verdadeiro.

## Persistência

As configurações incluem idioma base, idioma de aprendizagem e sentido. Backups antigos com `A_TO_B`/`B_TO_A` são migrados para `NORMAL`/`REVERSE`.

## Regra para futuras alterações

Não introduzir verificações espalhadas como `if (alemão)` ou acesso direto a `currentCard.pt/de` na camada de apresentação. Novos idiomas devem ser adicionados ao registry e respetivos campos de dados.
