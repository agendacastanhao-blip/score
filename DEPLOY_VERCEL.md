# Deploy no Vercel

Este projeto é um app estático (HTML/CSS/JS) e pode ser publicado direto no Vercel.

## Pré-requisitos
- Conta no Vercel com acesso ao time/projeto.
- Vercel CLI disponível localmente (`vercel`).

## Deploy via CLI
```bash
vercel login
vercel --prod
```

## Configuração usada
- Arquivo `vercel.json` com:
  - `cleanUrls`
  - `trailingSlash: false`
  - `Cache-Control: no-store` para garantir atualização de dados sem cache agressivo no client.

## Observações para integração
Se precisar conectar em projeto/time específico, informe:
- Nome do **team** no Vercel
- Nome do **project** (ou se devo criar novo)
- Se há domínio customizado para vincular
