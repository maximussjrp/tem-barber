# Tem Barber Premium Design System

**Versão:** 1.0 (Fase 1 - Fundação)

Este documento descreve a fundação visual oficial e reutilizável do Tem Barber. O Design System foi projetado com a filosofia de **"Luxo Operacional"**: interfaces confortáveis para uso longo e intenso no balcão da barbearia, mas com uma estética premium, sofisticada e rápida.

## 1. Princípios do Design System

1. **Zero-bloat:** Não utilizamos bibliotecas pesadas de UI (MUI, Chakra, Ant Design). Os componentes são construídos diretamente com Tailwind CSS v4 para máxima performance e controle, utilizando elementos HTML5 nativos sempre que possível (ex: `<dialog>` para overlays).
2. **Semântica:** O esquema de cores e tipografia é puramente semântico. Desenvolvedores não usam hexadecimais no código, nem variáveis estáticas (ex: `bg-stone-900`), mas sim os *tokens semânticos* (`bg-surface-raised`).
3. **Acessibilidade Inerente:** Componentes complexos (como Dialog e Drawers) tratam armadilhas de foco, travamento do body scroll, controle de backdrop e navegação pelo teclado (ESC).

## 2. Tokens Semânticos (`globals.css`)

Os tokens são expostos através do suporte oficial do Tailwind v4 (`@theme inline`), criando as variáveis CSS `--color-*`.

### Backgrounds & Surfaces
- `bg-background`: Fundo global da aplicação. (Escuro: `#0C0A09` / `stone-950`).
- `bg-surface`: Fundo padrão de componentes (Cards, Dialogs, Sidebars). (Escuro: `#1C1917` / `stone-900`).
- `bg-surface-raised`: Superfície elevada para destaque (Botões secundários, inputs).
- `bg-surface-hover`: Feedback visual para interatividade.
- `bg-surface-active`: Estado pressionado.

### Brand (Dourado)
- `bg-brand`: Cor principal de chamada à ação.
- `text-brand`: Texto destacado em dourado.
- `border-brand`: Bordas primárias.
- `bg-brand-hover` / `bg-brand-active`: Estados interativos.
- `bg-brand-subtle`: Fundo transparente/opaco usado para dar um tom dourado a fundos.

### Texto
- `text-text-primary`: Títulos, nomes, textos mais importantes.
- `text-text-secondary`: Parágrafos e labels genéricos.
- `text-text-muted`: Dicas e textos auxiliares.

### Status
Usados para faturamentos, agendamentos, cancelamentos e avisos.
- `success`: Ações bem sucedidas e Confirmações (`#10B981` / Emerald).
- `warning`: Alertas e Pendências (`#F59E0B` / Amber).
- `danger`: Erros, Exclusões e Cancelamentos (`#EF4444` / Red).
- `info`: Processamento e Ações neutras de sistema (`#3B82F6` / Blue).
As versões `-subtle` de cada um (ex: `bg-success-subtle`) são perfeitas para os componentes de `Badge`.

### Tipografia
Utiliza Google Fonts injetadas nativamente.
- **Títulos e Destaques Brand:** Playfair Display (Fonte Serif).
- **Texto e Leitura de Interface:** Outfit (Fonte Sans).

As classes literais deverão ser usadas em todo o projeto:
- `.heading-1`, `.heading-2`, `.heading-3`
- `.body-large`, `.body`, `.body-small`
- `.label`

## 3. Catálogo de Componentes (Primitives)

Localização: `src/components/ui/`

### `Button` & `IconButton`
Botões flexíveis com estados geridos por Tailwind. O estado nativo `isLoading={true}` substitui o childen por um spinner SVG nativo que bloqueia eventos adicionais da tag `<button>`.

### `Input` & `Select`
Variantes de formulário acessíveis (com tratamento dos atributos `aria-invalid` e `aria-describedby` nativamente gerenciados caso sejam fornecidos erros).

### `Card`, `Divider`, `Badge`
Utilizados em toda exibição de dados para organizar informações. O `StatusBadge` agora estende `Badge` para exibir `PENDING`, `CONFIRMED`, `COMPLETED` com o sinal semântico (Cor e Ponto opaco).

### `Dialog` e `ConfirmDialog`
- O `Dialog` empacota a API `<dialog>` do HTML5, trazendo Backdrop automático nativo (`backdrop:bg-backdrop`).
- É a base do sistema de janelas.
- O `ConfirmDialog` substitui o antigo padrão `window.confirm()` do JavaScript puro.

### `Sheet` (Gaveta Mobile)
Componente de Drawer que aparece pela lateral (esquerda/direita) utilizado fortemente na `Sidebar` e `MemberNav` para a navegação mobile. Renderiza o HTML5 `<dialog>` utilizando transformações CSS suaves na transição `open`.

## 4. Integração

Todas as novas páginas e refatorações devem obrigatoriamente importar e utilizar estes componentes primitivos ao invés de codificar classes tailwind estáticas diretamente nas páginas. Essa premissa garante o **"Luxo Operacional"** ao longo dos anos para o Tem Barber.
