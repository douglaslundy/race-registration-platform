# Reordenar menu do topo do admin

## Contexto

O menu de navegação do admin (`components/admin/AdminNav.tsx`) lista os links em uma ordem
arbitrária, acumulada conforme cada página foi adicionada ao longo do tempo. O usuário pediu uma
ordem específica, mais lógica para o fluxo de trabalho do admin.

Levantamento no código: o menu é definido em um único lugar (`components/admin/AdminNav.tsx:9-28`),
sem duplicação em nenhuma versão mobile/sidebar. Todos os 16 itens pedidos já existem como links —
nenhum item novo, nenhuma remoção, nenhuma mudança de href. É puramente uma reordenação.

## Design

Reordenar os elementos `<Link>` em `AdminNav.tsx` para seguir exatamente esta sequência:

```
Admin, Eventos, Usuários, Pagamentos, Pedidos vencidos, Cupons, Repasses,
Relatório, Conciliação, Auditoria, WhatsApp, Alertas, Config., Legal, Backup, Perfil
```

O grupo à direita (fora da sequência acima) permanece como está hoje: ícone de `ThemeToggle`,
depois o botão "Sair" — já corresponde ao final pedido ("...perfil, o ícone de tema, sair").

Nenhuma lógica muda: mesmos hrefs, mesmos textos, mesmos estilos — apenas a ordem das linhas.

## Fora de escopo

- Comportamento responsivo/mobile do menu (não existe hoje, não foi pedido).
- Qualquer mudança de texto, ícone, ou destino dos links.
