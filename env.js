import envvar from 'env-var';
import * as N3 from 'n3';
const { namedNode } = N3.DataFactory;

export const TEMP_GRAPH_PREFIX = envvar
  .get('TEMP_GRAPH_PREFIX')
  .default('http://mu.semte.ch/graphs/ingest')
  .asUrlString();

export const TEMP_GRAPH_INSERTS = `${TEMP_GRAPH_PREFIX}-inserts`;
export const TEMP_GRAPH_DELETES = `${TEMP_GRAPH_PREFIX}-deletes`;
export const TEMP_GRAPH_DISCARDS = `${TEMP_GRAPH_PREFIX}-discards`;

export const ORGANISATION_GRAPH_PREFIX = envvar
  .get('ORGANISATION_GRAPH_PREFIX')
  .default('http://mu.semte.ch/graphs/organizations/')
  .asUrlString();

export const BATCH_SIZE = envvar.get('BATCH_SIZE').default('100').asInt();

export const LOGLEVEL = envvar
  .get('LOGLEVEL')
  .default('silent')
  .asEnum(['error', 'info', 'silent']);

export const WRITE_ERRORS = envvar
  .get('WRITE_ERRORS')
  .default('false')
  .asBool();

export const ERROR_GRAPH = envvar
  .get('ERROR_GRAPH')
  .default('http://lblod.data.gift/errors')
  .asUrlString();

export const ERROR_BASE = envvar
  .get('ERR0R_BASE')
  .default('http://data.lblod.info/errors/')
  .asUrlString();

const PREFIXES = {
    besluit: 'http://data.vlaanderen.be/ns/besluit#',
    adms:  'http://www.w3.org/ns/adms#',
    skos: 'http://www.w3.org/2004/02/skos/core#',
    reorg: 'http://www.w3.org/ns/regorg#',
    lblodgeneriek: 'https://data.lblod.info/vocabularies/generiek/',
    org: 'http://www.w3.org/ns/org#',
    code: 'http://lblod.data.gift/vocabularies/organisatie/',
    adms: 'http://www.w3.org/ns/adms#',
    generiek: 'https://data.vlaanderen.be/ns/generiek#',
    ere: 'http://data.lblod.info/vocabularies/erediensten/',
    organisatie: 'https://data.vlaanderen.be/ns/organisatie#',
    mu: 'http://mu.semte.ch/vocabularies/core/',
    euvoc: 'http://publications.europa.eu/ontology/euvoc#',
    prov: 'http://www.w3.org/ns/prov#',
    schema: 'http://schema.org/',
    locn: 'http://www.w3.org/ns/locn#',
    foaf: 'http://xmlns.com/foaf/0.1/',
    ext:'http://mu.semte.ch/vocabularies/ext/',
    dcterms: 'http://purl.org/dc/terms/',
    geo: 'http://www.opengis.net/ont/geosparql#',
    adres: 'https://data.vlaanderen.be/ns/adres#',
    ns1:	'http://www.w3.org/ns/prov#',
    ns3:	'http://mu.semte.ch/vocabularies/ext/',
    rdfs:	'http://www.w3.org/2000/01/rdf-schema#',
    fv: 'http://data.lblod.info/vocabularies/FeitelijkeVerenigingen/',
    ns: 'https://data.lblod.info/ns/',
    verenigingen_ext: 'http://data.lblod.info/vocabularies/FeitelijkeVerenigingen/',
    vereniging: 'https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#',
    pav: 'http://purl.org/pav/',
    code: 'http://data.vlaanderen.be/id/concept/',
    person: 'http://www.w3.org/ns/person#',
    xsd: 'http://www.w3.org/2001/XMLSchema#'
};

const BASE = {
  error: 'http://data.lblod.info/errors/',
};

export const NAMESPACES = (() => {
  const all = {};
  for (const key in PREFIXES)
    all[key] = (pred) => namedNode(`${PREFIXES[key]}${pred}`);
  return all;
})();

export const BASES = (() => {
  const all = {};
  for (const key in BASE) all[key] = (pred) => namedNode(`${BASE[key]}${pred}`);
  return all;
})();

export const SPARQL_PREFIXES = (() => {
  const all = [];
  for (const key in PREFIXES) all.push(`PREFIX ${key}: <${PREFIXES[key]}>`);
  return all.join('\n');
})();
