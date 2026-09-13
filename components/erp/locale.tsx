"use client";
import {createContext,useContext,useEffect,useState} from 'react';
export type Lang='pt-BR'|'en-US'|'es-ES';
const lines=`Visão geral|Overview|Vista general
Meu negócio|My business|Mi negocio
Meus negócios|My businesses|Mis negocios
Fluxo da empresa|Business workflow|Flujo de la empresa
Financeiro|Finances|Finanzas
Produtos e serviços|Products and services|Productos y servicios
Precificação|Pricing|Precios
Marketplace|Marketplace|Marketplace
Estoque|Inventory|Inventario
Configurações|Settings|Configuración
Seu negócio, por inteiro.|Your business, all together.|Tu negocio, en un solo lugar.
Clareza para seguir em frente.|Clarity to move forward.|Claridad para seguir adelante.
Acompanhe o caixa, seus produtos e as próximas decisões.|Track cash flow, products and your next decisions.|Controla el flujo de caja, tus productos y próximas decisiones.
Dados de demonstração|Demo data|Datos de demostración
Demonstração interativa|Interactive demo|Demo interactiva
Explore à vontade. Os exemplos são reiniciados ao recarregar.|Explore freely. Demo data resets when you reload.|Explora libremente. Los ejemplos se reinician al recargar.
Entrar na minha conta|Sign in|Iniciar sesión
Usar meus dados|Use my data|Usar mis datos
Minha conta|My account|Mi cuenta
Sair|Sign out|Salir
Conectando sua empresa…|Loading your business…|Cargando tu negocio…
Novo lançamento|New transaction|Nuevo movimiento
Novo produto|New product|Nuevo producto
Adicionar negócio|Add business|Añadir negocio
Adicionar item|Add item|Añadir artículo
Editar|Edit|Editar
Excluir|Delete|Eliminar
Restaurar|Restore|Restaurar
Lixeira|Trash|Papelera
Ativos|Active|Activos
Salvar|Save|Guardar
Salvar alterações|Save changes|Guardar cambios
Cancelar|Cancel|Cancelar
Fechar|Close|Cerrar
Ações|Actions|Acciones
Nenhum registro encontrado.|No records found.|No se encontraron registros.
Buscar|Search|Buscar
Pesquisar|Search|Buscar
Todos|All|Todos
Nome|Name|Nombre
Descrição|Description|Descripción
Categoria|Category|Categoría
Modelo de operação|Operating model|Modelo de operación
Modelos relacionados|Related templates|Modelos relacionados
Escolha o modelo que melhor representa a operação. Os campos de custo se adaptam a ele.|Choose the template that best fits your operation. Cost fields adapt to it.|Elige el modelo que mejor represente tu operación. Los campos de costo se adaptan a él.
Sugestões da biblioteca, relacionadas ao nome informado.|Library suggestions matched to the name you entered.|Sugerencias de la biblioteca relacionadas con el nombre indicado.
E-mail de contato|Contact email|Correo de contacto
Telefone|Phone|Teléfono
Este negócio possui catálogo, estoque e financeiro próprios.|This business has its own catalog, inventory and finances.|Este negocio tiene su propio catálogo, inventario y finanzas.
Excluir este registro?|Delete this record?|¿Eliminar este registro?
O registro irá para a lixeira e poderá ser restaurado. O histórico será preservado.|The record will move to trash and can be restored. History is preserved.|El registro irá a la papelera y podrá restaurarse. Se conserva el historial.
Ao excluir um negócio, seus registros ficam preservados e voltam ao restaurá-lo.|Deleting a business preserves its records. Restore the business to access them again.|Al eliminar un negocio, sus registros se conservan y vuelven al restaurarlo.
Registro salvo.|Record saved.|Registro guardado.
Registro movido para a lixeira.|Record moved to trash.|Registro movido a la papelera.
Registro restaurado.|Record restored.|Registro restaurado.
Não foi possível salvar. Os campos foram preservados.|Unable to save. Your inputs were preserved.|No se pudo guardar. Se conservaron los campos.
Falha de conexão. Tente novamente.|Connection failed. Please try again.|Error de conexión. Inténtalo nuevamente.
Crie um negócio para começar.|Create a business to get started.|Crea un negocio para comenzar.
Selecione um negócio.|Select a business.|Selecciona un negocio.
Receitas|Income|Ingresos
Despesas|Expenses|Gastos
Resultado de caixa|Cash flow result|Resultado de caja
Venda média por unidade|Average selling price|Precio medio de venta
Receitas menos despesas realizadas.|Paid income minus paid expenses.|Ingresos cobrados menos gastos pagados.
Vendas vinculadas a produtos e quantidades.|Sales linked to products and quantities.|Ventas vinculadas a productos y cantidades.
A receber|Receivables|Por cobrar
A pagar|Payables|Por pagar
Movimentação financeira|Cash flow|Flujo de caja
Somente lançamentos realizados entram no gráfico e no resultado de caixa.|Only settled transactions appear in the chart and cash flow result.|Solo los movimientos realizados aparecen en el gráfico y el resultado de caja.
Dia|Day|Día
Semana|Week|Semana
Mês|Month|Mes
Ano|Year|Año
Período|Custom range|Período
Data de referência|Reference date|Fecha de referencia
De|From|Desde
Até|To|Hasta
Período inválido. Selecione até 10 anos.|Invalid range. Select up to 10 years.|Período inválido. Selecciona hasta 10 años.
Exportar CSV|Export CSV|Exportar CSV
Lançamento|Transaction|Movimiento
Data|Date|Fecha
Vencimento / data|Due date / date|Vencimiento / fecha
Status|Status|Estado
Valor|Amount|Importe
Realizado|Settled|Realizado
Pendente|Pending|Pendiente
Receita|Income|Ingreso
Despesa|Expense|Gasto
Tipo|Type|Tipo
Valor total|Total amount|Importe total
Cliente / fornecedor|Customer / supplier|Cliente / proveedor
Forma de pagamento|Payment method|Forma de pago
Transferência|Bank transfer|Transferencia
Cartão|Card|Tarjeta
Dinheiro|Cash|Efectivo
Outro|Other|Otro
Observações|Notes|Notas
Produto vendido|Product sold|Producto vendido
Sem vínculo|Not linked|Sin vínculo
Quantidade vendida|Quantity sold|Cantidad vendida
Lançamentos não alteram o estoque. Registre entradas e saídas na aba Estoque.|Transactions do not change stock. Record stock changes in Inventory.|Los movimientos financieros no cambian el inventario. Registra entradas y salidas en Inventario.
Catálogo do negócio|Business catalog|Catálogo del negocio
Cadastre fotos, custos, fornecedores e detalhes. O estoque é gerenciado por movimentações.|Add photos, costs, suppliers and details. Stock is managed through movements.|Añade fotos, costos, proveedores y detalles. El inventario se gestiona por movimientos.
Foto do produto|Product photo|Foto del producto
Enviar foto|Upload photo|Subir foto
Remover foto|Remove photo|Quitar foto
JPG, PNG ou WebP, até 5 MB.|JPG, PNG or WebP, up to 5 MB.|JPG, PNG o WebP, hasta 5 MB.
Imagem inválida. Use JPG, PNG ou WebP de até 5 MB.|Invalid image. Use JPG, PNG or WebP up to 5 MB.|Imagen no válida. Usa JPG, PNG o WebP de hasta 5 MB.
Produto / serviço|Product / service|Producto / servicio
Código SKU|SKU code|Código SKU
Fornecedor|Supplier|Proveedor
Localização|Location|Ubicación
Custo unitário|Unit cost|Costo unitario
Preço de venda|Selling price|Precio de venta
Margem bruta|Gross margin|Margen bruto
Saldo inicial|Opening stock|Saldo inicial
Estoque mínimo|Minimum stock|Stock mínimo
Unidade de medida|Unit of measure|Unidad de medida
Pronta entrega|Ready to sell|Listo para vender
Matéria-prima|Raw material|Materia prima
Peça / componente|Part / component|Pieza / componente
Serviço|Service|Servicio
Saldo atual|Current stock|Saldo actual
Disponível|Available|Disponible
Estoque baixo|Low stock|Stock bajo
Sem estoque|Out of stock|Sin existencias
Valor em estoque|Inventory value|Valor del inventario
Itens cadastrados|Registered items|Artículos registrados
Itens para repor|Items to restock|Artículos para reponer
Movimentar|Adjust stock|Mover stock
Entrada de estoque|Stock in|Entrada de stock
Saída de estoque|Stock out|Salida de stock
Quantidade|Quantity|Cantidad
Motivo|Reason|Motivo
Registrar movimentação|Record movement|Registrar movimiento
Histórico de movimentações|Movement history|Historial de movimientos
Saldo após movimento|Balance after movement|Saldo posterior
Saldo insuficiente ou item indisponível.|Insufficient stock or unavailable item.|Stock insuficiente o artículo no disponible.
Movimentação registrada.|Stock movement recorded.|Movimiento registrado.
Ajuste saldos na aba Estoque para manter o histórico.|Adjust quantities in Inventory to preserve movement history.|Ajusta las cantidades en Inventario para mantener el historial.
Veja produtos prontos, matérias-primas e peças. Filtre por tipo ou nível de estoque.|View finished products, raw materials and parts. Filter by type or stock level.|Consulta productos terminados, materias primas y piezas. Filtra por tipo o nivel de stock.
Seu preço, com todos os custos.|Your price, with every cost included.|Tu precio, con todos los costos.
Ajuste os parâmetros da operação e veja a composição do preço em tempo real.|Adjust operating parameters and see the price breakdown in real time.|Ajusta los parámetros y consulta el desglose del precio en tiempo real.
Simulação livre|Free simulation|Simulación libre
Produto a precificar|Product to price|Producto a calcular
Filtrar produtos|Filter products|Filtrar productos
Operação|Operation|Operación
Custos fixos|Fixed costs|Costos fijos
Taxas e margem|Fees and margin|Tasas y margen
Preço sugerido|Suggested price|Precio sugerido
Custo total|Total cost|Costo total
Taxas na venda|Selling fees|Tasas de venta
Resultado por unidade|Profit per unit|Beneficio por unidad
Aplicar preço ao produto|Apply price to product|Aplicar precio al producto
A simulação só altera o produto ao aplicar o preço.|The simulation updates the product only when you apply the price.|La simulación solo modifica el producto al aplicar el precio.
Materiais do lote|Batch materials|Materiales del lote
Peças e materiais|Parts and materials|Piezas y materiales
Horas do serviço|Service hours|Horas del servicio
Custo da mão de obra / hora|Labor cost / hour|Costo de mano de obra / hora
Aluguel mensal|Monthly rent|Alquiler mensual
Energia fixa mensal|Monthly fixed energy cost|Costo fijo mensual de energía
Outros custos fixos mensais|Other monthly fixed costs|Otros costos fijos mensuales
Horas produtivas mensais|Monthly productive hours|Horas productivas mensuales
Potência média da máquina (W)|Average machine power (W)|Potencia media de la máquina (W)
Tarifa de energia / kWh|Electricity rate / kWh|Tarifa eléctrica / kWh
Horas de impressão|Printing hours|Horas de impresión
Manutenção mensal da máquina|Monthly machine maintenance|Mantenimiento mensual de la máquina
Horas de máquina por mês|Monthly machine hours|Horas de máquina al mes
Peso de material (g)|Material weight (g)|Peso de material (g)
Custo do filamento / kg|Filament cost / kg|Costo del filamento / kg
Perdas estimadas (%)|Estimated waste (%)|Desperdicio estimado (%)
Horas de preparo e acabamento|Preparation and finishing hours|Horas de preparación y acabado
Embalagem por unidade|Packaging per unit|Embalaje por unidad
Rendimento do lote (un)|Batch yield (units)|Rendimiento del lote (un)
Horas de produção do lote|Batch production hours|Horas de producción del lote
Noites por estadia|Nights per stay|Noches por estancia
Noites ocupadas por mês|Occupied nights per month|Noches ocupadas al mes
Limpeza por estadia|Cleaning per stay|Limpieza por estancia
Consumo por diária|Daily consumption cost|Consumo por noche
Custos mensais do imóvel|Monthly property costs|Costos mensuales del inmueble
Compra por unidade|Purchase cost per unit|Compra por unidad
Frete por unidade|Shipping per unit|Envío por unidad
Unidades vendidas por mês|Units sold per month|Unidades vendidas al mes
Taxas e impostos (%)|Fees and taxes (%)|Tasas e impuestos (%)
Margem sobre a venda (%)|Margin on selling price (%)|Margen sobre la venta (%)
Filamento + perda estimada|Filament + estimated waste|Filamento + desperdicio estimado
Energia da impressão|Printing energy|Energía de impresión
Manutenção da máquina|Machine maintenance|Mantenimiento de máquina
Acabamento e preparo|Finishing and preparation|Acabado y preparación
Aluguel e outros custos rateados|Allocated rent and other costs|Alquiler y otros costos prorrateados
Embalagem|Packaging|Embalaje
Mão de obra|Labor|Mano de obra
Aluguel rateado|Allocated rent|Alquiler prorrateado
Energia fixa rateada|Allocated fixed energy|Energía fija prorrateada
Outras despesas rateadas|Other allocated expenses|Otros gastos prorrateados
Ingredientes + perdas por unidade|Ingredients + waste per unit|Ingredientes + pérdidas por unidad
Mão de obra por unidade|Labor per unit|Mano de obra por unidad
Custos fixos por unidade|Fixed costs per unit|Costos fijos por unidad
Custo mensal por noite ocupada|Monthly costs per occupied night|Costo mensual por noche ocupada
Limpeza por noite|Cleaning per night|Limpieza por noche
Consumo e reposições por noite|Consumption and supplies per night|Consumo y reposiciones por noche
Preencha valores válidos, iguais ou maiores que zero.|Enter valid values of zero or greater.|Introduce valores válidos iguales o mayores que cero.
Taxas e margem precisam somar menos de 100%.|Fees and margin must add up to less than 100%.|Las tasas y el margen deben sumar menos del 100%.
Informe as horas produtivas e as horas mensais da máquina.|Enter productive hours and monthly machine hours.|Indica las horas productivas y mensuales de máquina.
Horas produtivas mensais devem ser maiores que zero.|Monthly productive hours must be greater than zero.|Las horas productivas mensuales deben ser mayores que cero.
Informe rendimento do lote e horas produtivas.|Enter batch yield and productive hours.|Indica el rendimiento del lote y las horas productivas.
Informe noites por estadia e noites ocupadas por mês.|Enter nights per stay and occupied nights per month.|Indica las noches por estancia y ocupadas al mes.
Informe a quantidade esperada de vendas mensais.|Enter expected monthly unit sales.|Indica las ventas mensuales previstas.
Impressão 3D|3D printing|Impresión 3D
Mecânica e manutenção|Mechanics and maintenance|Mecánica y mantenimiento
Cozinha e produção|Kitchen and production|Cocina y producción
Hospedagem|Hospitality|Alojamiento
Comércio e revenda|Retail and resale|Comercio y reventa
Serviços e projetos|Services and projects|Servicios y proyectos
Material por peso, horas de máquina, energia, manutenção e acabamento.|Material by weight, machine hours, energy, maintenance and finishing.|Material por peso, horas de máquina, energía, mantenimiento y acabado.
Peças, horas de serviço, mão de obra e custos fixos por hora produtiva.|Parts, service hours, labor and fixed costs per productive hour.|Piezas, horas de servicio, mano de obra y costos fijos por hora productiva.
Ingredientes, perdas, embalagem e rendimento por lote.|Ingredients, waste, packaging and batch yield.|Ingredientes, pérdidas, embalaje y rendimiento por lote.
Limpeza por estadia, noites ocupadas, custos mensais e taxas.|Cleaning per stay, occupied nights, monthly costs and fees.|Limpieza por estancia, noches ocupadas, costos mensuales y tasas.
Compra, frete, embalagem e despesas rateadas por unidade.|Purchases, shipping, packaging and allocated costs per unit.|Compra, envío, embalaje y gastos prorrateados por unidad.
Materiais, horas de trabalho e custos fixos por hora.|Materials, working hours and fixed costs per hour.|Materiales, horas de trabajo y costos fijos por hora.
Compare antes de comprar.|Compare before you buy.|Compara antes de comprar.
Descreva produto, marca, cor e tamanho para encontrar ofertas mais próximas.|Describe the product, brand, color and size to find closer matches.|Describe el producto, marca, color y tamaño para encontrar ofertas similares.
Buscar melhores preços|Find best prices|Buscar mejores precios
Buscando ofertas…|Searching offers…|Buscando ofertas…
Loja|Store|Tienda
Menor preço|Lowest price|Menor precio
Maior preço|Highest price|Mayor precio
Relevância|Relevance|Relevancia
Ordenar por|Sort by|Ordenar por
Preço máximo|Maximum price|Precio máximo
Ver oferta|View offer|Ver oferta
Menor preço entre os resultados|Lowest price among results|Menor precio entre los resultados
Sem ofertas para estes filtros.|No offers match these filters.|No hay ofertas para estos filtros.
Frete informado pela loja|Shipping as listed by the store|Envío informado por la tienda
Frete não informado|Shipping not provided|Envío no informado
Os preços são das ofertas encontradas, sem conversão. Confira variante, frete e condições na loja.|Prices are from the offers found, without conversion. Check variant, shipping and terms at the store.|Los precios corresponden a las ofertas encontradas, sin conversión. Confirma variante, envío y condiciones en la tienda.
Busca aguardando configuração.|Search is awaiting setup.|Búsqueda pendiente de configuración.
Configure a chave SerpApi para consultar ofertas reais. Nenhum preço fictício será exibido.|Configure the SerpApi key to search real offers. No fictional prices will be displayed.|Configura la clave SerpApi para consultar ofertas reales. No se mostrarán precios ficticios.
Entre na sua conta para pesquisar ofertas.|Sign in to search offers.|Inicia sesión para buscar ofertas.
Busca indisponível. Tente novamente.|Search unavailable. Try again.|Búsqueda no disponible. Inténtalo nuevamente.
Sua conta, seu espaço.|Your account, your workspace.|Tu cuenta, tu espacio.
Entre ou crie uma conta para salvar seus negócios e trabalhar em outros dispositivos.|Sign in or create an account to save your businesses and work across devices.|Inicia sesión o crea una cuenta para guardar tus negocios y trabajar en otros dispositivos.
Continuar com Google|Continue with Google|Continuar con Google
Login Google aguardando configuração.|Google sign-in is awaiting setup.|Inicio con Google pendiente de configuración.
E-mail|Email|Correo electrónico
Senha|Password|Contraseña
Criar conta|Create account|Crear cuenta
Entrar|Sign in|Entrar
Já tenho conta|I have an account|Ya tengo cuenta
Quero criar conta|Create a new account|Quiero crear una cuenta
Confira seu e-mail para confirmar o cadastro.|Check your email to confirm registration.|Revisa tu correo para confirmar el registro.
Conta conectada.|Account connected.|Cuenta conectada.
Preferências regionais|Regional preferences|Preferencias regionales
Moeda|Currency|Moneda
Idioma|Language|Idioma
Moeda dos novos registros e filtro dos totais. Valores existentes mantêm a moeda original. Não há conversão automática.|Currency for new records and totals filter. Existing amounts keep their original currency. No automatic conversion.|Moneda de los nuevos registros y filtro de totales. Los importes existentes conservan su moneda original. Sin conversión automática.
Moedas ISO 4217 disponíveis no navegador.|ISO 4217 currencies supported by your browser.|Monedas ISO 4217 compatibles con tu navegador.
Conexões|Connections|Conexiones
Disponível para conectar|Ready to connect|Disponible para conectar
Falta configurar|Setup required|Falta configurar
Resend pausado para configuração posterior.|Resend is paused for later setup.|Resend pausado para configurar después.
Dados e descrições cadastrados não são traduzidos.|User-entered data and descriptions are not translated.|Los datos y descripciones introducidos no se traducen.
Detalhes|Details|Detalles
Todos os tipos|All types|Todos los tipos
Todos os saldos|All stock levels|Todos los niveles
Você está editando exemplos temporários.|You are editing temporary examples.|Estás editando ejemplos temporales.
As informações serão salvas na sua conta.|Information will be saved to your account.|La información se guardará en tu cuenta.
Mínimo|Minimum|Mínimo
Modelo|Template|Modelo
Gerenciar negócios|Manage businesses|Gestionar negocios
Novo negócio|New business|Nuevo negocio
Novo item|New item|Nuevo artículo
Moeda do registro|Record currency|Moneda del registro
Preço = custo ÷ (1 − taxas − margem).|Price = cost ÷ (1 − fees − margin).|Precio = costo ÷ (1 − tasas − margen).
Custos informados nesta simulação estão na moeda selecionada.|Costs in this simulation use the selected currency.|Los costos de esta simulación están en la moneda seleccionada.
Modelos prontos para a sua operação.|Templates ready for your operation.|Modelos listos para tu operación.
Escolha um negócio para acessar seus dados. Você pode editar o nome, trocar o modelo e restaurar negócios excluídos.|Choose a business to access its data. You can edit its name, change its template and restore deleted businesses.|Elige un negocio para acceder a sus datos. Puedes editar su nombre, cambiar su modelo y restaurar negocios eliminados.
Preparar|Prepare|Preparar
Precificar|Price|Calcular precio
Vender|Sell|Vender
Acompanhar|Monitor|Controlar
Cadastre produtos e insumos, com fotos, códigos e fornecedores.|Register products and materials with photos, codes and suppliers.|Registra productos e insumos con fotos, códigos y proveedores.
Calcule materiais, tempo e despesas com o modelo do seu negócio.|Calculate materials, time and expenses with your business template.|Calcula materiales, tiempo y gastos con el modelo de tu negocio.
Registre recebimentos e pagamentos e acompanhe as pendências.|Record income and payments and track pending transactions.|Registra cobros y pagos y controla los pendientes.
Confira o saldo, o estoque disponível e o que precisa repor.|Check balances, available stock and what needs restocking.|Consulta saldos, stock disponible y necesidades de reposición.
Abrir módulo|Open module|Abrir módulo
Sem foto|No photo|Sin foto
Selecionar|Select|Seleccionar
Foto indisponível|Photo unavailable|Foto no disponible
Recebimentos realizados no período.|Payments received during the period.|Cobros realizados en el período.
Pagamentos realizados no período.|Payments made during the period.|Pagos realizados en el período.`;
const translations=Object.fromEntries(lines.split('\n').filter(Boolean).map(l=>{const [pt,en,es]=l.split('|');return[pt,{'en-US':en,'es-ES':es}]}));
const Context=createContext<any>(null);
export function LocaleProvider({children}:{children:React.ReactNode}){const [lang,setLang]=useState<Lang>('pt-BR'),[currency,setCurrency]=useState('BRL'),[ready,R]=useState(false);useEffect(()=>{try{const p=JSON.parse(localStorage.getItem('fluxo-preferences')||'{}');if(['pt-BR','en-US','es-ES'].includes(p.lang))setLang(p.lang);if(/^[A-Z]{3}$/.test(p.currency||''))setCurrency(p.currency)}catch{}R(true)},[]);useEffect(()=>{if(ready){try{localStorage.setItem('fluxo-preferences',JSON.stringify({lang,currency}))}catch{}document.documentElement.lang=lang}},[lang,currency,ready]);const t=(s:string)=>lang==='pt-BR'?s:translations[s]?.[lang]||s;const money=(v:number,c=currency)=>new Intl.NumberFormat(lang,{style:'currency',currency:c}).format(v);return <Context.Provider value={{lang,setLang,currency,setCurrency,t,money}}>{children}</Context.Provider>}
export const useLocale=()=>useContext(Context) as {lang:Lang;setLang:(l:Lang)=>void;currency:string;setCurrency:(s:string)=>void;t:(s:string)=>string;money:(n:number,c?:string)=>string};
export function RegionalControls({compact=false}:{compact?:boolean}){const {lang,setLang,currency,setCurrency,t}=useLocale();const [codes,C]=useState(['BRL','USD','EUR','GBP']);useEffect(()=>C(Intl.supportedValuesOf('currency')),[]);const names=new Intl.DisplayNames([lang],{type:'currency'});return <div className={compact?'regional compact':'regional'}><label>{!compact&&t('Moeda')}<select aria-label={t('Moeda')} value={currency} onChange={e=>setCurrency(e.target.value)}>{codes.map(c=><option value={c} key={c}>{compact?c:c+' · '+names.of(c)}</option>)}</select></label><label>{!compact&&t('Idioma')}<select aria-label={t('Idioma')} value={lang} onChange={e=>setLang(e.target.value as Lang)}><option value="pt-BR">Português</option><option value="en-US">English</option><option value="es-ES">Español</option></select></label></div>}
