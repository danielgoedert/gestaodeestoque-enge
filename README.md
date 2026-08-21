# EngePro - Sistema de Gestão de Estoque

Sistema moderno, seguro e responsivo para gestão e controle de estoque desenvolvido para a **EngePro Consultoria Jr.**

---

## Principais Funcionalidades

- **Dashboard Executivo e Operacional**: KPIs em tempo real, curva ABC de produtos, gráficos de fluxo de entradas/saídas e indicadores de performance.
- **Gestão de Produtos**: Catálogo completo com códigos, categorias, níveis de estoque (mínimo, atual, máximo) e custos unitários.
- **Importação e Exportação de Planilhas**: Suporte a importação de arquivos `.xlsx` e `.csv` com pré-visualização padrão e exportação higienizada contra injeção de fórmulas CSV.
- **Central de Estoque e Notificações**: Alertas em tempo real para itens críticos, sem estoque ou em ponto de reposição.
- **Gestão de Compras e Reposição**: Geração e acompanhamento de pedidos de compras baseados na necessidade real do estoque.
- **Gestão e Avaliação de Fornecedores**: Cadastro completo com histórico de compras, índice de pontualidade e notas de qualidade.
- **Relatórios Automatizados**: Emissão de relatórios gerenciais e operacionais com múltiplos filtros e períodos.
- **Segurança Avançada**:
  - Criptografia universal **SHA-256** com *salt* exclusivo por usuário.
  - Proteção contra **Força Bruta** (*Rate Limiting*).
  - Proteção e sanitização contra **SQL Injection** e **XSS**.
  - Controle de Acesso Baseado em Funções (**RBAC**) para Administradores e Operadores.
  - **Trilha de Auditoria** (*Audit Trail*) com registro de todas as operações sensíveis.

---

## Tecnologias Utilizadas

- **HTML5** e **CSS3 Moderno** (Variáveis CSS, Flexbox, Grid)
- **JavaScript ES6+** com Web Crypto API
- **Lucide Icons** para ícones vetoriais
- **Chart.js** para renderização de gráficos interativos

---

## Como Executar

Basta abrir o arquivo `index.html` em qualquer navegador moderno.
