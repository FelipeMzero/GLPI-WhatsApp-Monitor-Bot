# 🤖 🎫 GLPI WhatsApp Monitor Bot

Bot de alta performance em **Node.js** para monitoramento em tempo real de chamados do GLPI. Gerencie todas as configurações via interface web.

---

## 🛠️ Requisitos

- **Node.js** v20 ou superior
- **Chrome/Chromium** instalado no servidor

---

## 📥 Instalação

```bash
npm install
```

---

## ⚙️ Configuração Segura (`.env`)

Apenas as chaves de API devem ficar no arquivo `.env`. O restante é configurado pelo painel.

```ini
GLPI_APP_TOKEN=seu_app_token_aqui
GLPI_USER_TOKEN=seu_user_token_aqui

# Configurações Iniciais (opcional, serão sobrescritas pelo painel)
GLPI_URL= IP ou URL do seu GLPI
WHATSAPP_TARGET= Nome do Grupo ou Numero de Telefone
POLLING_INTERVAL=3 - Tempo de Resposta
PORT=3000 - Porta do Navegador
```

---

## 🖥️ Painel de Controle (Configuração Dinâmica)

Acesse **http://localhost:3000** para gerenciar o bot sem editar arquivos:

1.  **Botão "Editar":** Altere a URL do GLPI, o intervalo de busca e o destino (Grupo ou Número) em tempo real.
2.  **Persistência:** Suas alterações são salvas em um arquivo `config.json` e mantidas mesmo após reiniciar o bot.
3.  **Monitoramento Live:** Acompanhe o console de atividade e o status da conexão.
4.  **Limpeza de Instância:** Desconecte ou troque de WhatsApp com um clique.

---

## 👥 Como configurar o Alvo
- **Para Grupos:** Digite o nome exato (ex: `grupo`).
- **Para Números:** Digite o número com 55 (ex: `5592991112233`).

---

## 🎫 Notificações

- **Novo Chamado:** ID, Assunto, Categoria, Localização, Requisitante e Descrição.
- **Chamado Finalizado:** ID, Assunto, Status e Técnico responsável.

---
**Desenvolvido por Felipe Monteiro.** 🚀
