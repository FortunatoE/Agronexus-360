export const pendingOrderDetailFields = {
  orderDate: {
    key: "od",
    aliases: ["Data Ped", "Dt. Ped", "Data pedido", "Dt. pedido", "Data do pedido", "Data de emissão", "Data do documento", "Data documento", "Data doc.", "Dt. doc.", "Data doc.compra", "Data do documento de compras", "Data de criação do pedido"],
  },
  item: { key: "oi", aliases: ["Item", "Item Ped", "Item do pedido", "Item do documento de compras"] },
  ordered: {
    key: "oq",
    aliases: ["Qtd.pedido", "Qtd. ped.", "Qtde. pedido", "Qtde. ped.", "Qtd. do pedido", "Quantidade do pedido", "Quantidade pedida", "Quantidade pedido"],
  },
  delivered: {
    key: "dq",
    aliases: ["Qtde. Forn", "Qtd. Forn", "Qtd. entregue", "Qtde. entregue", "Quantidade entregue", "Qtd. fornecida", "Qtde. fornecida", "Quantidade fornecida", "Qtd. recebida", "Quantidade recebida"],
  },
  remaining: {
    key: "rq",
    aliases: ["Saldo Forn", "Saldo fornecedor", "Saldo fornecer", "Saldo a fornecer", "Falta entregar", "Saldo pendente", "Qtd. em aberto", "Quantidade em aberto"],
  },
};

export const pendingOrderQuantityAliases = [
  ...pendingOrderDetailFields.remaining.aliases, ...pendingOrderDetailFields.ordered.aliases, "Volume solicitado", "Quantidade",
];
