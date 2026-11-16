// Modelos do prontuário: perguntas da anamnese e termos de consentimento.
// São pontos de partida: a clínica deve revisar os textos com o jurídico / responsável técnico.

export interface AnamnesisQuestion {
  id: string;
  q: string;
  type: 'yesno' | 'text';
  /** "Sim" vira alerta no prontuário (aparece em destaque para a equipe). */
  alertOnYes?: boolean;
  /** Pede detalhe quando a resposta é "Sim" (ou sempre, para texto). */
  detail?: string;
}

export interface AnamnesisSection {
  title: string;
  items: AnamnesisQuestion[];
}

export const ANAMNESIS_TEMPLATE: AnamnesisSection[] = [
  {
    title: 'Queixa e expectativa',
    items: [
      { id: 'complaint', q: 'O que mais te incomoda hoje e gostaria de melhorar?', type: 'text' },
      { id: 'expectation', q: 'Qual resultado você espera do tratamento?', type: 'text' },
    ],
  },
  {
    title: 'Saúde geral',
    items: [
      { id: 'treatment', q: 'Está em tratamento médico atualmente?', type: 'yesno', detail: 'Qual?' },
      { id: 'meds', q: 'Usa algum medicamento de forma contínua?', type: 'yesno', detail: 'Quais?' },
      { id: 'anticoag', q: 'Usou anticoagulante, AAS, anti-inflamatório ou ômega 3 nos últimos 7 dias?', type: 'yesno', alertOnYes: true, detail: 'Qual e quando?' },
      { id: 'allergy', q: 'Tem alergia a medicamentos, anestésicos, látex, cosméticos ou alimentos?', type: 'yesno', alertOnYes: true, detail: 'A quê?' },
      { id: 'pregnant', q: 'Está grávida, tentando engravidar ou amamentando?', type: 'yesno', alertOnYes: true },
      { id: 'diabetes', q: 'Tem diabetes?', type: 'yesno', alertOnYes: true },
      { id: 'pressure', q: 'Tem pressão alta ou problema cardíaco? Usa marca-passo?', type: 'yesno', alertOnYes: true, detail: 'Qual?' },
      { id: 'autoimmune', q: 'Tem doença autoimune (lúpus, artrite reumatoide, vitiligo, psoríase…)?', type: 'yesno', alertOnYes: true, detail: 'Qual?' },
      { id: 'neuromuscular', q: 'Tem doença neuromuscular (miastenia gravis, esclerose…)?', type: 'yesno', alertOnYes: true },
      { id: 'bleeding', q: 'Tem distúrbio de coagulação ou sangra com facilidade?', type: 'yesno', alertOnYes: true },
      { id: 'epilepsy', q: 'Tem epilepsia ou convulsões?', type: 'yesno', alertOnYes: true },
      { id: 'cancer', q: 'Tem ou teve câncer? Está em quimioterapia ou radioterapia?', type: 'yesno', alertOnYes: true, detail: 'Detalhe' },
      { id: 'herpes', q: 'Tem herpes labial com frequência?', type: 'yesno', alertOnYes: true },
      { id: 'keloid', q: 'Tem tendência a queloide ou cicatriz alta?', type: 'yesno', alertOnYes: true },
      { id: 'metal', q: 'Tem implante metálico, prótese ou fio de ouro na região a tratar?', type: 'yesno', alertOnYes: true, detail: 'Onde?' },
      { id: 'skin', q: 'Tem alguma doença de pele ativa (acne inflamada, rosácea, infecção) na região?', type: 'yesno', alertOnYes: true, detail: 'Qual?' },
    ],
  },
  {
    title: 'Histórico estético',
    items: [
      { id: 'botox', q: 'Já aplicou toxina botulínica (Botox)?', type: 'yesno', detail: 'Quando foi a última?' },
      { id: 'filler', q: 'Já fez preenchimento (ácido hialurônico ou outro)?', type: 'yesno', detail: 'Produto, região e quando' },
      { id: 'biostim', q: 'Já fez bioestimulador de colágeno, fios ou PMMA?', type: 'yesno', alertOnYes: true, detail: 'Qual, onde e quando' },
      { id: 'surgery', q: 'Já fez cirurgia plástica ou procedimento a laser no rosto/corpo?', type: 'yesno', detail: 'Qual e quando' },
      { id: 'adverse', q: 'Já teve reação ruim a algum procedimento estético?', type: 'yesno', alertOnYes: true, detail: 'O que aconteceu?' },
      { id: 'isotretinoin', q: 'Usou isotretinoína (Roacutan) nos últimos 6 meses?', type: 'yesno', alertOnYes: true },
      { id: 'acids', q: 'Usa ácidos ou retinoides na pele atualmente?', type: 'yesno', detail: 'Quais?' },
      { id: 'sun', q: 'Teve exposição intensa ao sol ou bronzeamento nos últimos 15 dias?', type: 'yesno', alertOnYes: true },
    ],
  },
  {
    title: 'Hábitos',
    items: [
      { id: 'smoke', q: 'Fuma?', type: 'yesno', detail: 'Quantos por dia?' },
      { id: 'alcohol', q: 'Consome bebida alcoólica com frequência?', type: 'yesno' },
      { id: 'sunscreen', q: 'Usa protetor solar todos os dias?', type: 'yesno' },
      { id: 'notes', q: 'Algo mais que a profissional deva saber?', type: 'text' },
    ],
  },
];

export interface ConsentTemplate {
  key: string;
  title: string;
  text: string;
}

const COMMON_END = `Declaro que li este termo, que tive a oportunidade de fazer perguntas e que elas foram respondidas de forma clara. Declaro que as informações que prestei na anamnese são verdadeiras e que comunicarei à clínica qualquer alteração no meu estado de saúde.

Comprometo-me a seguir as orientações pré e pós-procedimento e a comparecer aos retornos combinados. Entendo que o resultado varia de pessoa para pessoa e depende da resposta do meu organismo, não sendo possível garantir um resultado específico.

Autorizo a realização do procedimento descrito acima pela profissional responsável da {clinica}.`;

export const DEFAULT_CONSENTS: ConsentTemplate[] = [
  {
    key: 'generic',
    title: 'Termo de consentimento – procedimento estético',
    text: `Eu, {paciente}, autorizo a realização do procedimento {procedimento} na {clinica}.

Fui informada sobre a natureza do procedimento, seus objetivos, benefícios esperados, alternativas de tratamento, cuidados necessários e possíveis efeitos adversos, que podem incluir vermelhidão, inchaço, dor, hematomas, sensibilidade local e, mais raramente, infecção, alergia ou resultado assimétrico.

${COMMON_END}`,
  },
  {
    key: 'toxin',
    title: 'Termo de consentimento – toxina botulínica',
    text: `Eu, {paciente}, autorizo a aplicação de toxina botulínica ({procedimento}) na {clinica}.

Fui informada de que a toxina botulínica relaxa temporariamente a musculatura tratada, com início de efeito entre 2 e 15 dias e duração média de 4 a 6 meses, variando de pessoa para pessoa.

Possíveis efeitos adversos: dor ou ardência na aplicação, vermelhidão, pequenos hematomas, dor de cabeça, assimetria, sensação de peso, queda da pálpebra ou da sobrancelha (geralmente temporárias) e, raramente, reação alérgica.

Orientações: não deitar nem abaixar a cabeça por 4 horas; não massagear a região; evitar atividade física intensa, calor excessivo e bebida alcoólica nas primeiras 24 horas. Eventual retoque deve ser avaliado em retorno de 15 dias.

Declaro não estar grávida nem amamentando e não ter doença neuromuscular.

${COMMON_END}`,
  },
  {
    key: 'filler',
    title: 'Termo de consentimento – preenchimento com ácido hialurônico',
    text: `Eu, {paciente}, autorizo o preenchimento com ácido hialurônico ({procedimento}) na {clinica}.

Fui informada de que o ácido hialurônico é absorvível, com duração média de 6 a 18 meses conforme produto e região, e que pode ser dissolvido com hialuronidase se necessário.

Possíveis efeitos adversos: inchaço, vermelhidão, dor, hematomas, nódulos, assimetria, infecção, reação inflamatória tardia e, raramente, comprometimento vascular (oclusão), que exige atendimento imediato. Fui orientada a procurar a clínica com urgência se notar dor intensa, palidez ou arroxeamento da pele, ou alteração visual.

Orientações: evitar maquiagem por 12 horas, calor, sauna, atividade física intensa e bebida alcoólica por 48 horas; não pressionar nem massagear sem orientação.

${COMMON_END}`,
  },
  {
    key: 'biostimulator',
    title: 'Termo de consentimento – bioestimulador de colágeno',
    text: `Eu, {paciente}, autorizo a aplicação de bioestimulador de colágeno ({procedimento}) na {clinica}.

Fui informada de que o resultado é gradual, aparecendo ao longo de semanas a meses, e que podem ser necessárias mais de uma sessão.

Possíveis efeitos adversos: inchaço, dor, hematomas, vermelhidão, sensibilidade, formação de nódulos ou pápulas, assimetria e, raramente, infecção ou reação granulomatosa.

Orientações: realizar a massagem indicada pela profissional, quando prescrita; evitar calor intenso, sauna e atividade física intensa nas primeiras 48 horas.

${COMMON_END}`,
  },
  {
    key: 'threads',
    title: 'Termo de consentimento – fios de PDO',
    text: `Eu, {paciente}, autorizo a aplicação de fios de polidioxanona (PDO) ({procedimento}) na {clinica}.

Fui informada de que os fios são absorvíveis e estimulam colágeno, com resultado progressivo.

Possíveis efeitos adversos: dor, inchaço, hematomas, irregularidades ou ondulações na pele, sensação de repuxamento, extrusão ou palpação do fio, assimetria e, raramente, infecção.

Orientações: evitar movimentos amplos da face, dormir de barriga para cima, não massagear a região e evitar atividade física intensa por 7 dias, salvo orientação diferente.

${COMMON_END}`,
  },
  {
    key: 'energy',
    title: 'Termo de consentimento – ultrassom microfocado, laser e radiofrequência',
    text: `Eu, {paciente}, autorizo a realização de {procedimento} na {clinica}.

Fui informada de que o tratamento usa energia (ultrassom microfocado, laser ou radiofrequência) para estimular colágeno ou tratar a pele, com resultado gradual e possibilidade de mais de uma sessão.

Possíveis efeitos adversos: dor ou desconforto durante a aplicação, vermelhidão, inchaço, sensibilidade, formigamento, manchas temporárias, crostas, bolhas ou queimaduras e, raramente, alteração de pigmentação.

Declaro não ter implantes metálicos ou marca-passo na região tratada e não estar grávida. Fui orientada a usar protetor solar e evitar exposição ao sol conforme indicado.

${COMMON_END}`,
  },
  {
    key: 'peel',
    title: 'Termo de consentimento – peeling químico',
    text: `Eu, {paciente}, autorizo a realização de peeling químico ({procedimento}) na {clinica}.

Fui informada de que haverá descamação da pele nos dias seguintes, variando com o tipo de peeling.

Possíveis efeitos adversos: ardência, vermelhidão, descamação, sensibilidade, manchas (hiper ou hipopigmentação), crostas e, raramente, infecção ou cicatriz.

Orientações: não arrancar as peles; usar protetor solar e evitar sol; suspender ácidos conforme orientação; hidratar a pele.

${COMMON_END}`,
  },
];

/** Escolhe o modelo pelo nome do procedimento (o termo pode ser trocado na hora). */
export function suggestConsentKey(procedureName: string | null | undefined): string {
  const n = (procedureName ?? '').toLowerCase();
  if (/botox|toxina|dysport|xeomin/.test(n)) return 'toxin';
  if (/preench|hialur|labial|olheira/.test(n)) return 'filler';
  if (/bioestim|sculptra|radiesse|elleva/.test(n)) return 'biostimulator';
  if (/fio|pdo/.test(n)) return 'threads';
  if (/ultraformer|ultrassom|lavieen|laser|radiofreq|hifu/.test(n)) return 'energy';
  if (/peeling/.test(n)) return 'peel';
  return 'generic';
}

export const IMAGE_USE_LABELS: Record<string, string> = {
  NONE: 'Não autorizo o uso das minhas fotos fora do prontuário.',
  INTERNAL: 'Autorizo o uso das minhas fotos apenas para acompanhamento clínico e discussão técnica, sem me identificar.',
  MARKETING: 'Autorizo a divulgação das minhas fotos de antes e depois nas redes sociais e materiais da clínica, sem expor meu nome.',
};
