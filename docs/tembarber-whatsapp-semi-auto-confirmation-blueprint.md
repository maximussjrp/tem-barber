# Blueprint - Confirmacao semiautomatica de WhatsApp por token

## 1. Resumo executivo

Este blueprint define a proposta tecnica para confirmacao semiautomatica gratuita de agendamentos via WhatsApp no Tem Barber.

A ideia e manter o booking online normal, reservar o slot no momento da criacao do appointment e, apos o sucesso, orientar o cliente a enviar uma mensagem pre-preenchida para o WhatsApp da barbearia contendo um token curto do agendamento. A barbearia confere a mensagem recebida e confirma manualmente no painel administrativo.

Escopo deste documento:

- Auditar o fluxo atual de booking publico e agenda admin.
- Definir o MVP sem WhatsApp API, webhook, SMS ou gateway nao oficial.
- Comparar alternativas de status/modelagem.
- Propor token, link `wa.me`, UX publica, UX admin, rotas, migration e testes.
- Registrar riscos, faseamento e GO/NO-GO.

Fora do escopo:

- Implementacao.
- Migration.
- Integracao com WhatsApp Cloud API.
- Leitura automatica de mensagens.
- Envio SMS/OTP.
- Gateway WhatsApp Web nao oficial.
- Commit, push, PR ou deploy.

Conclusao: viavel sem API paga para confirmacao assistida/manual. Nao e confirmacao automatica real, porque o sistema nao recebe a mensagem do WhatsApp; a prova operacional e o aceite manual da equipe.

## 2. Fluxo atual

### Booking publico

Arquivo principal:

- `src/app/api/public/barbershop/[slug]/book/route.ts`

O agendamento publico e criado no `POST /api/public/barbershop/[slug]/book`.

Fluxo observado:

1. Recebe `memberId`, `serviceIds`, `dateTime`, `customerName`, `customerPhone`, `notes` e `idempotencyKey`.
2. Bloqueia `bookingMode = FIT_IN` no publico.
3. Aplica rate limit publico por slug/IP/telefone.
4. Valida slug e barbearia publica.
5. Valida assinatura ativa do tenant.
6. Usa idempotencia com `Idempotency-Key` e `idempotency_keys`.
7. Executa transaction serializable com retry.
8. Valida capacidade profissional x servico via `validateProfessionalServiceCapability`.
9. Resolve/cria cliente pelo telefone ou usa sessao existente.
10. Bloqueia duplicidade do cliente no mesmo horario.
11. Aplica limite semanal de agendamentos futuros ativos.
12. Cria o appointment via `createAppointmentWithScheduleLock`.
13. Salva o resultado na chave de idempotencia.
14. Retorna `201` com objeto `appointment`.

Status atual apos booking publico:

- `Appointment.status` tem default `CONFIRMED` no schema.
- O booking publico nao informa status explicitamente na criacao; portanto o appointment nasce `CONFIRMED`.
- O payload de sucesso tambem retorna `status`.

### Tela publica de agendamento

Arquivo:

- `src/app/[slug]/agendar/page.tsx`

O wizard publico tem etapas:

1. Servico.
2. Barbeiro.
3. Horario.
4. Dados.
5. Confirmar.

Depois do sucesso, a propria pagina renderiza uma tela final local quando `confirmed` esta preenchido.

Tela final atual:

- Titulo: `Agendado!`
- Texto: `Seu horario esta confirmado.`
- Card com data, horario, barbeiro, servicos e total.
- Botoes `Voltar` e `Meus agendamentos`.

Hoje nao ha botao `Confirmar pelo WhatsApp` nessa tela.

### Link wa.me existente

Existe helper manual em:

- `src/lib/whatsapp.ts`

Funcoes atuais:

- `formatWhatsAppPhone(phone)`
- `generateWhatsAppMessage(customerName, barbershopName, time, serviceNames)`
- `generateWhatsAppLink(phone, message)`

Uso atual:

- `src/app/admin/agendamentos/page.tsx`
- Botao `Enviar Lembrete por WhatsApp`
- O destino atual e o telefone do cliente (`appointment.customer.phone`), nao o telefone da barbearia.
- O link usa `https://wa.me/{phone}?text={encodeURIComponent(message)}`.

Tambem existe `src/components/admin/WhatsAppShareSlots.tsx`, que compartilha horarios livres com `https://wa.me/?text=...`, sem numero de destino.

### Model Appointment e status

Trechos relevantes do schema:

- `AppointmentStatus`: `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`.
- `Appointment.status`: default `CONFIRMED`.
- `AppointmentBookingMode`: `NORMAL`, `FIT_IN`.
- `Appointment` ja possui `barbershopId`, `memberId`, `customerId`, `dateTime`, `totalPrice`, `durationMin`, `status`, `bookingMode`, campos de encaixe e `notes`.
- `AppointmentService` faz o vinculo appointment x servico e salva `priceApplied`.

Status ativos usados para bloqueio de agenda:

- Em booking publico, duplicidade/limite semanal consideram `PENDING` e `CONFIRMED`.
- Em availability/conflito, o padrao do projeto tambem trata `PENDING` e `CONFIRMED` como ativos.
- Na agenda admin, `PENDING` e `CONFIRMED` aparecem como estados operacionais diferentes.

### WhatsApp/telefone da barbearia

Model atual:

- `Barbershop.phone String`

Rotas/UI:

- `GET /api/public/barbershop/[slug]` retorna `barbershop.phone`.
- `GET /api/admin/barbershop` retorna o registro da barbearia.
- `PUT /api/admin/barbershop` aceita `phone` e salva `phone.replace(/\D/g, "")`.
- `src/app/admin/configuracoes/page.tsx` possui campo de telefone.
- `src/app/[slug]/page.tsx` exibe `barbershop.phone`.

Observacao importante:

- Nao existe campo separado `whatsappPhone`.
- O telefone da barbearia nao e validado com a mesma regra forte de celular BR observada para clientes.
- O admin salva apenas digitos, mas nao garante canonico internacional com `55`.
- Para o MVP, pode-se usar `Barbershop.phone` como WhatsApp da barbearia somente se validado/canonizado.

### Permissoes admin na agenda

`getAdminSession` devolve `barbershopId`, `userId`, `memberId` e `role`.

Roles de membro:

- `OWNER`
- `MANAGER`
- `BARBER`

Na agenda atual, varios endpoints administrativos usam `getAdminSession`, mas o `PATCH /api/admin/appointments/[id]` de status nao aplica restricao especifica por role alem de exigir sessao administrativa do tenant. Para confirmacao WhatsApp, a permissao deve ser explicitada.

### Audit log

Nao ha `AuditLog` nem `AppointmentStatusLog` implementados no schema atual.

Os documentos de roadmap/especificacao mencionam essas entidades como pendentes. Portanto, para o MVP, a trilha minima precisa ficar na propria entidade de confirmacao WhatsApp com `confirmedAt` e `confirmedById`.

## 3. MVP proposto

Fluxo recomendado:

1. Cliente agenda normalmente no wizard publico.
2. Backend cria o `Appointment` como hoje, com slot reservado.
3. Backend cria uma confirmacao WhatsApp pendente vinculada ao appointment.
4. Backend retorna dados de confirmacao no payload de booking ou a tela busca por endpoint publico seguro.
5. Tela final troca o tom de `Agendado! Seu horario esta confirmado.` para `Falta confirmar pelo WhatsApp`.
6. Tela mostra o codigo curto e um botao `Confirmar pelo WhatsApp`.
7. Botao abre `wa.me` para o WhatsApp da barbearia com mensagem pre-preenchida.
8. A barbearia recebe a mensagem no WhatsApp e confere codigo/dados.
9. No painel admin, o appointment aparece com badge `Pendente WhatsApp`.
10. Owner/Manager clica `Confirmar WhatsApp`.
11. Sistema salva status, horario e usuario que confirmou.
12. Slot continua bloqueado durante todo o processo.

Nao implementar no MVP:

- leitura automatica de mensagens;
- webhook;
- WhatsApp Cloud API;
- gateway nao oficial;
- SMS;
- cancelamento automatico por expiracao;
- token como mecanismo publico de acesso a dados.

## 4. Decisao de status

Alternativas avaliadas:

### A. Manter Appointment CONFIRMED e adicionar status de confirmacao separado

Descricao:

- `Appointment.status` continua `CONFIRMED`.
- A confirmacao WhatsApp possui status proprio, por exemplo `PENDING`, `CONFIRMED`, `EXPIRED`, `CANCELLED`.

Impacto:

- Agenda e disponibilidade seguem bloqueando o slot.
- Comissao, comanda, no-show, cancelamento e CRM continuam lendo `Appointment.status` sem quebra.
- Evita reinterpretar `PENDING`, que hoje ja existe como "aguardando confirmacao/aprovacao manual".
- Exige UI admin mostrar badge adicional alem do status do appointment.

Recomendacao: SIM.

### B. Criar AppointmentStatus PENDING_WHATSAPP_CONFIRMATION

Descricao:

- Adicionar novo valor ao enum `AppointmentStatus`.

Impacto:

- Exige revisar todos os filtros de status ativo.
- Alto risco de deixar availability, conflitos, comanda, comissoes, metricas ou CRM ignorando o novo status.
- Migration de enum e ajustes amplos.
- Pode quebrar fluxos que assumem status conhecidos.

Recomendacao: NAO para MVP.

### C. Criar tabela separada sem alterar AppointmentStatus

Descricao:

- Manter `Appointment.status = CONFIRMED`.
- Criar `AppointmentWhatsappConfirmation`.

Impacto:

- Preserva comportamento operacional.
- Isola LGPD/auditoria.
- Evita poluir `Appointment`.
- Facilita evoluir para WhatsApp API no futuro.

Recomendacao: SIM, combinada com alternativa A.

Decisao recomendada:

```text
Appointment.status = CONFIRMED
AppointmentWhatsappConfirmation.status = PENDING | CONFIRMED | EXPIRED | CANCELLED
```

## 5. Modelagem

### Opcao A - campos no Appointment

Campos possiveis:

- `whatsappConfirmationTokenHash`
- `whatsappConfirmationCode`
- `whatsappConfirmationStatus`
- `whatsappConfirmationExpiresAt`
- `whatsappConfirmedAt`
- `whatsappConfirmedById`

Vantagens:

- Menos joins.
- Implementacao inicial mais simples.
- Consulta da agenda traz tudo direto.

Desvantagens:

- Polui `Appointment` com um fluxo especifico.
- Dificulta historico/regeneracao de token.
- Mais dificil evoluir para multiplas tentativas/canais.
- Aumenta superficie de dados sensiveis em toda consulta de appointment.

### Opcao B - tabela separada

Modelo recomendado:

```prisma
enum WhatsappConfirmationStatus {
  PENDING
  CONFIRMED
  EXPIRED
  CANCELLED
}

model AppointmentWhatsappConfirmation {
  id            String   @id @default(uuid())
  appointmentId String   @unique @map("appointment_id")
  barbershopId  String   @map("barbershop_id")
  customerPhone String?  @map("customer_phone")
  tokenHash     String   @map("token_hash")
  tokenHint     String   @map("token_hint")
  status        WhatsappConfirmationStatus @default(PENDING)
  expiresAt     DateTime? @map("expires_at")
  confirmedAt   DateTime? @map("confirmed_at")
  confirmedById String?   @map("confirmed_by_id")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  appointment Appointment @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  barbershop  Barbershop  @relation(fields: [barbershopId], references: [id], onDelete: Cascade)
  confirmedBy BarbershopMember? @relation(fields: [confirmedById], references: [id], onDelete: SetNull)

  @@index([barbershopId, status])
  @@index([barbershopId, expiresAt])
  @@map("appointment_whatsapp_confirmations")
}
```

Observacao: se `confirmedById` apontar para `User`, perde-se um pouco da semantica de role/tenant no momento da acao. Como a confirmacao e operacional por tenant, `BarbershopMember` e mais adequado. Se houver casos de `SUPER_ADMIN`, avaliar campo separado ou permitir `confirmedByUserId`.

Recomendacao: Opcao B.

## 6. Token

Formato recomendado:

```text
TB-123456
```

Regras:

- Aleatorio, nao sequencial.
- 6 digitos numericos com prefixo fixo `TB-`.
- Gerado por fonte criptograficamente segura.
- Salvar hash do token, nao token puro.
- Mostrar o token puro somente no retorno imediato do booking/tela final.
- Persistir apenas `tokenHash` e `tokenHint`.
- `tokenHint` pode ser os ultimos 2 ou 3 digitos, por exemplo `***456`, para apoio visual no admin.

Hash:

- Usar SHA-256 com pepper de servidor, ou HMAC-SHA-256 com segredo de ambiente.
- Como o token tem baixa entropia, hash puro sem segredo e fraco contra brute force offline se o banco vazar.
- O segredo deve ser configurado em env quando a implementacao ocorrer.

Expiracao:

- Recomendado criar `expiresAt`, mas no MVP nao cancelar automaticamente.
- Valor sugerido: 24 horas apos criacao ou ate o inicio do appointment, o que vier primeiro.
- Expiracao serve como sinal operacional e preparacao futura, nao como cancelamento automatico no MVP.

Se expirar:

- MVP: admin ainda pode confirmar manualmente com aviso `Token expirado`.
- Futuro: exigir regeneracao ou bloquear confirmacao expirada conforme politica do produto.

Regeneracao:

- Nao incluir no MVP inicial.
- Futuro: endpoint admin `POST /api/admin/appointments/[id]/whatsapp-confirmation/regenerate`.
- Regeneracao deve invalidar token anterior e registrar quem regenerou.

Tentativas:

- Como o MVP nao tem input publico de token, nao ha tentativa publica a limitar.
- Se houver endpoint futuro para cliente confirmar token, exigir rate limit e evitar enumeracao.

## 7. Link wa.me

Helper recomendado:

```ts
generateBarbershopWhatsappConfirmationLink({
  barbershopPhone,
  barbershopName,
  token,
  customerName,
  customerPhone,
  date,
  time,
  services,
})
```

Destino:

- WhatsApp da barbearia.
- Inicialmente pode ser `Barbershop.phone`, desde que validado e canonizado.

Mensagem sugerida:

```text
Ola, quero confirmar meu agendamento na {barbershopName}.

Codigo: {token}
Nome: {customerName}
Data: {date}
Horario: {time}
Servico: {services}
Meu WhatsApp: {customerPhone}

Enviei esta mensagem para confirmar meu telefone.
```

Regras:

- Normalizar destino para numero internacional aceito pelo WhatsApp, sem `+`, preferencialmente `55DDDN`.
- Usar `encodeURIComponent` no texto.
- Nao incluir identificadores internos sensiveis.
- Nao incluir links administrativos.
- Funcionar mobile e desktop com `https://wa.me/{phone}?text={encodedText}`.
- Se nao houver telefone valido da barbearia, nao exibir o botao; exibir instrucao alternativa ou aviso operacional.

Reuso:

- `src/lib/whatsapp.ts` ja possui padrao de formatacao e geracao de link.
- O helper atual e orientado a lembrete para cliente; criar funcoes especificas para confirmacao da barbearia evita misturar semanticas.

## 8. Configuracao WhatsApp barbearia

Estado atual:

- Existe `Barbershop.phone`.
- Nao existe `Barbershop.whatsappPhone`.
- O admin salva o telefone com apenas digitos.
- Nao ha validacao forte garantindo celular BR, DDI 55 ou compatibilidade WhatsApp.

Perguntas respondidas:

| Pergunta | Resposta |
|---|---|
| Campo existe? | Existe `Barbershop.phone`. |
| E validado? | Apenas obrigatorio e salvo com digitos; nao ha validacao forte de WhatsApp/celular. |
| Esta canonico com 55? | Nao garantido. |
| Precisa configurar por tenant? | Sim. O numero de destino e da barbearia/tenant. |
| Fallback para owner phone e aceitavel? | Nao recomendado para MVP sem decisao explicita; pode expor telefone pessoal e confundir operacao. |
| O que fazer sem WhatsApp configurado? | Criar appointment normalmente, mas nao mostrar botao automatico; admin deve ver pendencia de configuracao. |

Recomendacao de modelagem:

- Para MVP rapido: reutilizar `Barbershop.phone`, mas adicionar validacao/canonizacao antes de ativar o fluxo.
- Para desenho mais claro: adicionar `whatsappPhone` em `Barbershop`, separado de telefone institucional.

Preferencia tecnica:

- Criar `Barbershop.whatsappPhone String? @map("whatsapp_phone")`.
- Permitir configurar por tenant em `admin/configuracoes`.
- Validar como celular BR ou numero internacional aceito pelo WhatsApp.
- Salvar canonico sem `+`, por exemplo `5517991234567`.

## 9. UX publica

Tela final proposta apos booking:

Titulo:

```text
Falta confirmar pelo WhatsApp
```

Texto:

```text
Seu horario foi reservado. Para confirmar, envie a mensagem automatica para a barbearia pelo WhatsApp.
```

Elementos:

- Codigo visivel: `TB-123456`.
- Resumo do agendamento: data, horario, barbeiro, servicos, total.
- Botao principal: `Confirmar pelo WhatsApp`.
- Link secundario: `Copiar mensagem`.
- Aviso: `A confirmacao e feita pela barbearia apos receber sua mensagem.`
- Botao secundario: `Meus agendamentos` ou `Voltar`.

Obrigatoriedade:

- O botao nao pode ser tecnicamente obrigatorio, porque o cliente pode fechar a aba.
- O slot ja fica reservado.
- A barbearia ve a pendencia e decide contato/cancelamento manual.

Retorno apos WhatsApp:

- MVP sem tela de retorno.
- `wa.me` abre em nova aba/app.
- Futuro: botao `Ja enviei` que apenas muda estado visual local, sem confirmar no backend.

Sem WhatsApp da barbearia:

- Mostrar sucesso de reserva, mas sem botao `wa.me`.
- Texto sugerido: `Seu horario foi reservado. A barbearia ainda nao configurou um WhatsApp de confirmacao.`
- Admin deve receber sinal operacional para configurar o numero.

## 10. UX admin

Agenda/modal:

Se pendente:

- Badge `Pendente WhatsApp`.
- Token hint, por exemplo `Codigo termina em 456`.
- Telefone do cliente.
- Botao `Confirmar WhatsApp`.
- Botao `Copiar codigo`.
- Botao `Abrir WhatsApp` para conversa com cliente, se necessario.
- Data de expiracao, se houver.

Depois de confirmado:

- Badge `WhatsApp confirmado`.
- `confirmedAt`.
- `confirmedBy`.

Estados visuais:

| Estado appointment | Estado WhatsApp | Badge principal sugerido |
|---|---|---|
| CONFIRMED | PENDING | Pendente WhatsApp |
| CONFIRMED | CONFIRMED | WhatsApp confirmado |
| CONFIRMED | EXPIRED | WhatsApp expirado |
| CANCELLED | PENDING/CONFIRMED | Nao destacar confirmacao como acao ativa |

Permissoes:

- `OWNER`: pode confirmar.
- `MANAGER`: pode confirmar.
- `BARBER`: recomendacao inicial e nao permitir no MVP, para reduzir ambiguidade operacional.
- Alternativa futura: `BARBER` pode confirmar somente seus proprios appointments (`appointment.memberId === session.memberId`).

Racional:

- Confirmar WhatsApp e uma acao administrativa de validacao de identidade/contato, nao apenas gestao de execucao do servico.
- Como o `PATCH /api/admin/appointments/[id]` atual nao tem matriz fina de permissao por status, a nova rota deve ter checagem explicita.

## 11. Disponibilidade

Regra recomendada:

- Appointment pendente de WhatsApp continua bloqueando slot.
- Appointment pendente aparece na agenda.
- Appointment pendente conta como agendamento futuro.
- Appointment pendente entra no limite semanal do cliente.
- Appointment pendente pode ser cancelado manualmente.

Como implementar conceitualmente:

- Manter `Appointment.status = CONFIRMED`.
- Nao criar novo `AppointmentStatus`.
- Availability e conflito continuam funcionando sem ajustes profundos, pois o slot segue em `CONFIRMED`.

Impacto em dominios:

| Dominio | Impacto recomendado |
|---|---|
| Agenda admin | Mostrar badge adicional, sem alterar bloco do appointment. |
| Disponibilidade publica | Slot bloqueado. |
| Comissao | Nao gerar comissao por confirmacao WhatsApp; comissao continua ligada a atendimento/comanda. |
| Comanda | Pode abrir atendimento mesmo se pendente? Recomendado avisar; nao bloquear no MVP salvo decisao operacional. |
| No-show | Continua possivel marcar falta. |
| CRM 360 | Mostrar estado de confirmacao quando disponivel. |
| Lembretes | Lembretes podem continuar existindo; mensagem deve considerar se WhatsApp esta pendente. |
| Cancelamento | Cancelar appointment deve cancelar/encerrar confirmacao pendente. |
| Encaixe | Encaixe admin pode ou nao exigir confirmacao; recomendacao: nao criar confirmacao WhatsApp para `FIT_IN` no MVP. |
| Contagem | Conta como reservado/futuro. |

## 12. Expiracao/cancelamento

MVP recomendado:

- Sem cancelamento automatico.
- Criar `expiresAt` opcional como metadado.
- Mostrar pendente/expirado no admin.
- Admin pode confirmar expirado manualmente, com aviso.
- Cancelamento do appointment deve marcar confirmacao como `CANCELLED` se ainda estiver pendente.

Por que nao auto-cancelar no MVP:

- Exige job/cron confiavel.
- Pode liberar slot sem acao humana depois de o cliente ter enviado mensagem.
- Cria risco operacional se a barbearia demora a conferir o WhatsApp.

Futuro:

- Job a cada poucos minutos cancela pendencias vencidas.
- Regras por tenant: 30 min, 1h, 24h, ate X horas antes do atendimento.
- Notificacao/alerta antes do cancelamento.

## 13. Seguranca/LGPD

Regras:

- Token nao sequencial.
- Token persistido como hash com segredo.
- Token nao deve autenticar acesso publico a dados.
- Nao expor `tokenHash`.
- Nao expor telefone completo desnecessariamente em endpoints publicos.
- Mensagem WhatsApp deve conter dados minimos para conferenca: codigo, nome, data, horario, servicos, telefone informado.
- Confirmacao manual deve gravar `confirmedAt` e `confirmedById`.
- Rotas admin devem validar tenant (`barbershopId`) e permissao.
- Endpoints publicos, se criados, devem usar identificador publico de baixa sensibilidade e rate limit.
- Evitar endpoint publico de busca por token.
- Nao usar API/gateway nao oficial.

LGPD:

- O cliente aciona voluntariamente o WhatsApp e envia a mensagem.
- A URL `wa.me` contem texto com dados pessoais codificados; isso e necessario para a finalidade, mas deve ser minimizado.
- Politica/termos devem deixar claro que a confirmacao e feita via WhatsApp da barbearia.
- Evitar incluir preco se nao for necessario; pode ficar apenas na tela, nao na mensagem.

## 14. Rotas

### Publicas

Opcao recomendada para MVP:

- Nenhuma rota publica nova obrigatoria.
- `POST /api/public/barbershop/[slug]/book` retorna tambem `whatsappConfirmation`.

Payload de resposta conceitual:

```json
{
  "appointment": {
    "id": "...",
    "dateTime": "...",
    "status": "CONFIRMED",
    "totalPrice": "50.00",
    "durationMin": 30,
    "barberName": "Joao",
    "customerName": "Maria",
    "services": ["Corte"],
    "barbershopName": "Tem Barber",
    "barbershopSlug": "tem-barber"
  },
  "whatsappConfirmation": {
    "status": "PENDING",
    "token": "TB-123456",
    "expiresAt": "...",
    "waLink": "https://wa.me/5517991234567?text=..."
  }
}
```

Cuidados de idempotencia:

- Se o booking for replay idempotente, a resposta precisa conseguir devolver os mesmos dados.
- Como o token puro nao deve ficar salvo, ha tensao entre hash-only e replay exato.

Opcoes:

1. Salvar o payload completo de resposta em `IdempotencyKey.result`, incluindo token/link, como ja ocorre para booking.
2. Salvar token criptografado reversivel, nao recomendado para MVP.
3. Em replay, retornar sem token puro e orientar a tela a usar mensagem copiada anteriormente, ruim para UX.

Recomendacao:

- Usar `IdempotencyKey.result` para replay dentro da janela de idempotencia.
- Persistir na tabela somente hash/hint.

Rota publica opcional:

- `GET /api/public/appointments/[publicToken]/whatsapp-confirmation-link`

Nao recomendada no MVP, porque introduz token publico de acesso e mais superficie de enumeracao.

### Admin

Rota principal:

```text
POST /api/admin/appointments/[id]/confirm-whatsapp
```

Permissao:

- `OWNER` e `MANAGER`.
- Opcional futuro: `BARBER` apenas se `appointment.memberId === session.memberId`.

Payload:

```json
{
  "token": "TB-123456"
}
```

Ou, para confirmacao apenas por clique sem input:

```json
{}
```

Recomendacao:

- MVP com clique sem input, pois a conferencia acontece visualmente no WhatsApp da barbearia.
- O admin visualiza hint/codigo informado pelo cliente e confirma manualmente.
- Se houver input de token, limitar tentativas e registrar falhas.

Resposta:

```json
{
  "confirmation": {
    "status": "CONFIRMED",
    "confirmedAt": "...",
    "confirmedBy": {
      "id": "...",
      "name": "Ana"
    }
  }
}
```

Erros:

| Caso | Status | Codigo |
|---|---:|---|
| appointment inexistente no tenant | 404 | `APPOINTMENT_NOT_FOUND` |
| sem permissao | 403 | `FORBIDDEN` |
| sem confirmacao criada | 404 | `WHATSAPP_CONFIRMATION_NOT_FOUND` |
| appointment cancelado/no-show/completed | 422 | `APPOINTMENT_NOT_CONFIRMABLE` |
| ja confirmado | 200 ou 409 | `ALREADY_CONFIRMED` |

Idempotencia admin:

- Recomendado tratar confirmar duas vezes como idempotente: retornar `200` com estado ja confirmado.
- Se confirmado por outro usuario, retornar dados existentes.

Rotas futuras:

- `POST /api/admin/appointments/[id]/whatsapp-confirmation/regenerate`
- `POST /api/admin/appointments/[id]/whatsapp-confirmation/expire`
- `GET /api/admin/appointments/[id]/whatsapp-confirmation`

## 15. Migration

Migration necessaria? SIM.

Motivo:

- O schema atual nao tem tabela/campos para status de confirmacao WhatsApp, token hash, expiracao ou usuario que confirmou.

Mudancas recomendadas:

1. Criar enum `WhatsappConfirmationStatus`.
2. Criar model `AppointmentWhatsappConfirmation`.
3. Adicionar relacionamentos em `Appointment`, `Barbershop` e possivelmente `BarbershopMember`.
4. Opcionalmente adicionar `Barbershop.whatsappPhone`.

Indices:

- `@@unique([appointmentId])`
- `@@index([barbershopId, status])`
- `@@index([barbershopId, expiresAt])`

Tenant isolation:

- A tabela deve ter `barbershopId` redundante alem de `appointmentId`.
- Toda query admin deve filtrar por `appointmentId` e `barbershopId`.
- Idealmente criar validacao transacional para garantir que `appointment.barbershopId === confirmation.barbershopId`.

Sem migration nesta etapa:

- Este documento apenas recomenda. Nenhum arquivo de schema/migration deve ser criado agora.

## 16. Testes

### Unitarios

Token:

1. Gera token no formato `TB-123456`.
2. Token e aleatorio e nao sequencial.
3. Hash/compare funciona.
4. Hash nao salva token puro.
5. Hint e derivado corretamente.

WhatsApp:

1. Normaliza telefone BR para `55DDDN`.
2. Rejeita telefone invalido.
3. Gera `wa.me` com destino da barbearia.
4. Usa `encodeURIComponent`.
5. Mensagem contem token, nome, data, horario e servicos.
6. Mensagem nao contem ids internos.

Status:

1. Confirmacao nasce `PENDING`.
2. Confirmacao muda para `CONFIRMED`.
3. Confirmacao expirada segue politica definida.
4. Cancelamento do appointment cancela/encerra pendencia.

### Integracao

1. Booking publico cria `Appointment` `CONFIRMED`.
2. Booking publico cria `AppointmentWhatsappConfirmation` `PENDING`.
3. Resposta do booking contem token/link quando barbearia tem WhatsApp valido.
4. Resposta nao contem `tokenHash`.
5. Slot pendente fica bloqueado.
6. Limite semanal considera appointment pendente de WhatsApp.
7. Idempotencia retorna o mesmo resultado dentro da janela.
8. Admin OWNER confirma.
9. Admin MANAGER confirma.
10. Admin BARBER e rejeitado no MVP.
11. Tenant A nao confirma appointment do tenant B.
12. Confirmar duas vezes retorna estado claro/idempotente.
13. Cancelar appointment marca confirmacao pendente como `CANCELLED`.
14. Telefone de barbearia ausente/invalido nao quebra booking.

### UI

Publico:

1. Tela final mostra `Falta confirmar pelo WhatsApp`.
2. Mostra codigo.
3. Botao abre `wa.me`.
4. Mostra resumo do agendamento.
5. Mostra alternativa quando nao ha WhatsApp configurado.

Admin:

1. Badge `Pendente WhatsApp` aparece na agenda/modal.
2. Botao `Confirmar WhatsApp` aparece para OWNER/MANAGER.
3. Botao nao aparece ou e bloqueado para BARBER.
4. Apos confirmar, badge muda para `WhatsApp confirmado`.
5. Mostra `confirmedAt` e `confirmedBy`.

## 17. Faseamento

Recomendacao: dividir em PRs pequenos, porque ha migration e UX em duas superficies.

### PR 1 - Modelagem e backend minimo

Escopo:

- Migration com enum/tabela.
- Helper de token/hash.
- Helper de link `wa.me` para confirmacao.
- Booking publico cria confirmacao pendente.
- Payload de booking retorna `whatsappConfirmation`.
- Rota admin `POST /api/admin/appointments/[id]/confirm-whatsapp`.
- Testes unitarios/integracao principais.

### PR 2 - UX publica e admin

Escopo:

- Tela final publica com botao `Confirmar pelo WhatsApp`.
- Badge e acoes no modal da agenda admin.
- Exibir `confirmedAt`/`confirmedBy`.
- Ajustar listagem GET de appointments para incluir confirmacao.
- Testes UI.

### PR 3 - Configuracao e refinamentos operacionais

Escopo:

- Campo `whatsappPhone` da barbearia, se decidido.
- Validacao/canonizacao no admin.
- Avisos de configuracao pendente.
- Filtros/relatorios por pendente/confirmado.

### Futuro

- Expiracao automatica por job.
- Regeneracao de token.
- WhatsApp Cloud API com webhook oficial.
- Historico/audit log generico.
- Confirmacao automatica por mensagem recebida, se houver provedor oficial.

Alternativa:

- Um unico PR com tudo e possivel, mas aumenta risco por envolver schema, booking, admin e UI publica. Para esta feature, fasear e mais seguro.

## 18. Riscos

Riscos operacionais:

- Cliente pode nao clicar no WhatsApp e mesmo assim o slot fica reservado.
- Barbearia pode esquecer de confirmar manualmente.
- Sem auto-cancelamento, pendencias antigas podem acumular.
- Telefone da barbearia pode estar errado ou nao ser WhatsApp.

Riscos tecnicos:

- Replay idempotente precisa lidar com token puro exibido apenas uma vez.
- Criar novo status em `AppointmentStatus` teria alto risco de quebrar disponibilidade; por isso nao recomendado.
- Sem `AuditLog`, a auditoria fica limitada aos campos da tabela de confirmacao.
- Se o token for salvo puro, aumenta risco LGPD/seguranca.

Riscos LGPD:

- Mensagem `wa.me` contem dados pessoais no texto da URL.
- Deve-se minimizar dados e nao incluir informacoes sensiveis desnecessarias.

Riscos de produto:

- Confirmacao semiautomatica pode ser confundida com confirmacao automatica.
- A UX deve deixar claro que a barbearia confirma apos receber a mensagem.

## 19. GO/NO-GO

GO para implementar como MVP semiautomatico, com condicoes:

- Manter `Appointment.status = CONFIRMED` para nao quebrar disponibilidade.
- Criar tabela separada `AppointmentWhatsappConfirmation`.
- Slot pendente fica reservado.
- Usar `wa.me` oficial, sem API paga e sem gateway nao oficial.
- Nao ler mensagens automaticamente.
- Salvar hash do token, nao token puro.
- Registrar `confirmedAt` e `confirmedById`.
- Permitir confirmacao apenas para OWNER/MANAGER no MVP.
- Criar migration em PR proprio/faseado.
- Validar ou separar o WhatsApp da barbearia antes de depender dele.

NO-GO para:

- Criar `PENDING_WHATSAPP_CONFIRMATION` em `AppointmentStatus` no MVP.
- Usar WhatsApp Web nao oficial.
- Usar token como autenticacao publica.
- Auto-cancelar por expiracao sem job/auditoria/UX bem definidos.
- Fallback silencioso para telefone pessoal do owner.
