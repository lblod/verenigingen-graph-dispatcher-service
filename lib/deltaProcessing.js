import * as rst from 'rdf-string-ttl';
import * as sjp from 'sparqljson-parse';
import * as mas from '@lblod/mu-auth-sudo';
import * as env from '../env';
import * as pbu from './parse-bindings-utils';
import * as sts from './storeToTriplestore';
import * as app from '../app';
import * as N3 from 'n3';
import { NAMESPACES as ns } from '../env';
const { namedNode } = N3.DataFactory;
import pta from '../config/pathsToAdministrativeUnit';

/**
 * Main entry function for processing deltas. Stores inserts in the correct
 * organisation graph (configurable via query paths) and performs deletes in
 * the temporary data and the organisation graph. It processes deletions of
 * data before insertions of data per changeset in the order they appear.
 *
 * @async
 * @function
 * @param {Iterable} changesets - This is an iterable collection of changesets
 * from the delta-notifier, usually an Array with objects like `{ inserts:
 * [...], deletes: [...] }`
 * @returns {Object} An object with properties `inserts` and `deletes` that
 * contain the results from `processInserts` and `processDeletes` respectively.
 * @throws Will rethrow an exception if any error has occured (network, SPARQL,
 * timeout, ...)
 */
export async function processDeltaChangesets(changesets) {
  const flattenedChangesets = flattenChangesets(changesets);
  let deletesResults = [];
  let insertsResults = [];
  for (const changeset of flattenedChangesets) {
    const deleteRes = await processDeletes(changeset.deletes);
    const insertRes = await processInserts(changeset.inserts);
    deletesResults = deletesResults.concat(deleteRes);
    insertsResults = insertsResults.concat(insertRes);
  }
  return {
    inserts: insertsResults,
    deletes: deletesResults,
  };
}

/**
 * Takes a collection of inserts and processes them. They are inserted in the
 * graph for the correct organisation and removed from the temporary insert
 * graph. The organisation graph is found by querying configurable paths (see
 * the `config/pathsToAdministrativeUnit.js` file).
 *
 * @see dispatch
 * @async
 * @function
 * @param {Iterable} inserts - An iterable with triples formatted in JSON
 * syntax, e.g. `{ subject: {...}, predicate: {...}, object: {...}, graph:
 * {...} }`. These are usually the contents of changesets from the
 * delta-notifier.
 * @returns {Object | Array(Object)} Either an object with properties `success`
 * (Boolean), `mode` (String) and `reason` (String) or the  array of results
 * from `dispatch`.
 * @throws Will throw an exception on any kind of error.
 */
async function processInserts(inserts) {
  //Convert to store
  const store = new N3.Store();
  inserts.forEach((insert) => {
    //Filter for the inserts or deletes graph used for ingesting
    if (env.TEMP_GRAPH_INSERTS === insert.graph.value)
      store.addQuad(pbu.parseSparqlJsonBindingQuad(insert));
  });

  //Nothing in the store, nothing to do.
  if (store.size < 1)
    return {
      success: false,
      mode: 'Insert',
      reason: 'Nothing in the inserts to process.',
    };

  //Get all subjects from the store and their type from the triplestore (could
  //be in any graph)
  const subjects = store.getSubjects();
  const subjectsWithTypes = await getTypesForSubjects(subjects);

  return dispatch(subjectsWithTypes);
}

/**
 * Holds a timer for scanning and processing the inserts. This is executed
 * every time a processing has succesfully dispatched at least one subject to
 * try and see if another subject can be moved.
 * @see scanAndProcess
 *
 * @global
 */
let scanAndProcessTimer;

/**
 * @see processInserts
 * This is the second half of that function. It starts from a store containing
 * at least one subject and its type to find the organisation graph and move
 * the data.
 *
 * @async
 * @function
 * @param {Array(Object(subject: NamedNode, type: NamedNode))}
 * subjectsWithTypes - An array of JavaScript objects with the subject and type
 * as RDF.JS NamedNode terms.
 * @returns {Array(Object)} An array of objects per processed subjects. Every
 * object contains properties `success` (Boolean), `mode` (String), `subject`
 * (NamedNode) and `reason` (String), but might also contain some more helpful
 * debugging data such as the `organisationUUIDs` (Array) or
 * `organisationGraph` (NamedNode).
 * @throws Will throw an exception on any kind of error.
 */
async function dispatch(subjectsWithTypes) {
  const results = [];
  let needsToSchedule = false;
  for (const { subject, type } of subjectsWithTypes) {
    if (env.LOGLEVEL === 'info')
      console.log(
        `Trying to dispatch info about ${subject.value} for type: ${type.value}`,
      );
    const organisationUUIDs = await getOrganisationUUIDs(subject, type);


    const config = pta.find((cfg) => cfg.type.value === type.value);

    if (
      organisationUUIDs.length === 1 ||
      (organisationUUIDs.length > 1 && config?.allowedInMultipleOrgs)
    ) {
      for (const organisationUUID of organisationUUIDs) {
        const organisationGraphs = [
          `${env.ORGANISATION_GRAPH_PREFIX}${organisationUUID}`,
        ].map(namedNode);
          const insertGraph = namedNode(env.TEMP_GRAPH_INSERTS);
          // const discardGraph = namedNode(env.TEMP_GRAPH_DISCARDS);
          await moveSubjectBetweenGraphs(subject, insertGraph, organisationGraphs);
          results.push({
            success: true,
            mode: 'Insert',
            subject,
            type,
            reason: 'Data successfully moved for this subject.',
            organisationUUID,
            organisationGraphs
          });
        }
    } else if (organisationUUIDs.length > 1 && !config?.allowedInMultipleOrgs) {
      //Append a result object to indicate a failure to move the data
      results.push({
        success: false,
        mode: 'Insert',
        subject,
        type,
        reason:
          'Too many possible organisations (and data not allowed in multiple organisations)',
        organisationUUIDs,
      });
    } else {
      //Append result object to indicate nothing could be done, but this is
      //actually a rather normal occurence
      results.push({
        success: false,
        mode: 'Insert',
        subject,
        type,
        reason: `No organisation found. This could be normal. This subject is tried again later. It was about subject: ${subject.value} for type: ${type.value}`,
      });
    }
  }
  if (needsToSchedule) {
    if (scanAndProcessTimer) {
      clearTimeout(scanAndProcessTimer);
      scanAndProcessTimer = undefined;
    }
    scanAndProcessTimer = setTimeout(async () => {
      await app.encapsulatedScanAndProcess(false);
    }, 5000);
  }
  return results;
}

/**
 * Takes a collection of deletes and processes them. If a triple appears in
 * **one** graph that looks like an organisation graph, it is deleted from
 * there. They are also deleted from the temporary inserts and deletes graph.
 * If the triple appears in more than one organisation graph, it has to be left
 * alone and nothing is deleted.
 *
 * Deletes triples from temporary inserts. (This is a bit of a guess, we assume
 * triples are unique accross the whole database. We have to do this because we
 * can't link every deleted triple on its own to an organisation.) Also removes
 * delete triples from the temporary deletes, that graph should be empty if
 * there are no problematic triples.
 *
 * @see deleteTriples
 * @async
 * @function
 * @param {Iterable} inserts - An iterable with triples formatted in JSON
 * syntax, e.g. `{ subject: {...}, predicate: {...}, object: {...}, graph:
 * {...} }`. These are usually the contents of changesets from the
 * delta-notifier.
 * @returns {Object | Array(Object)} Either an object with properties `success`
 * (Boolean), `mode` (String) and `reason` (String) or the  array of results
 * from `deleteTriples`.
 * @throws Will throw an exception on any kind of error.
 */
async function processDeletes(deletes) {
  //Convert to store
  const store = new N3.Store();
  deletes.forEach((triple) => {
    //Filter for the inserts or deletes graph used for ingesting
    if (env.TEMP_GRAPH_DELETES === triple.graph.value)
      store.addQuad(pbu.parseSparqlJsonBindingQuad(triple));
  });

  //Nothing in the store, nothing to do.
  if (store.size < 1)
    return {
      success: false,
      mode: 'Delete',
      reason: 'Nothing in the deletes to process.',
    };

  return deleteTriples(store);
}

/*
 * @see processDeletes
 * Second half of that function. It starts with a store containing all the
 * triples that need to be deleted.
 *
 * @async
 * @function
 * @param {N3.Store} store - Store containing the triples to be deleted. This
 * could be the contents of the temporary deletes graph.
 * @param {Boolean} [doGraphSearch = true] Set whether or not we still have to
 * search for all the graphs the triples appear in. If false, we can assume the
 * different graphs for the triples are already present in the data.
 * @returns {Array(Object)} An array of objects, only for failed deletes.
 * Failures will be rare, but successes will be plenty so we don't want all
 * those logs. These objects have properties `success` (Boolean),  `mode`
 * (String), `reason` (String), `triple` (Quad), and `graph` (NamedNode).
 * @throws Will throw an exception on any kind of error.
 */
async function deleteTriples(store, doGraphSearch = true) {
  const results = [];
  let storeWithAllGraphs;
  if (doGraphSearch) {
    //Query for every triple all the graphs it exists in
    storeWithAllGraphs = await getGraphsForTriples(store);
  } else {
    storeWithAllGraphs = store;
  }
  const problematicTriples = [];
  for (const triple of store) {
    const graphs = storeWithAllGraphs
      .getGraphs(triple.subject, triple.predicate, triple.object)
      .filter((g) => g.value !== env.TEMP_GRAPH_DELETES)
      .filter((g) => g.value !== env.TEMP_GRAPH_INSERTS)
      .filter((g) => g.value.includes(env.ORGANISATION_GRAPH_PREFIX));
    if (graphs.length > 1) {
      //Triple found in more than 1 organisation graph. Mark this triple as
      //problematic so that it won't be removed
      problematicTriples.push(triple);
      results.push({
        success: false,
        mode: 'Delete',
        reason: 'More than one organisation graph found. Not removing triple.',
        triple,
        graphs,
      });
    }
    //else: This is good: the triple only exists in one graph and because of
    //the similar URI, it must be the correct organisation graph. This triple
    //can be removed from all the graphs previously found.
  }
  problematicTriples.forEach((t) => {
    storeWithAllGraphs.removeQuad(t.subject, t.predicate, t.object);
  });
  await sts.deleteData(storeWithAllGraphs);
  return results;
}

/**
 * Instead of starting from incoming changesets, this function can be called on
 * its own to attempt to scan the temporary inserts and deletes graphs for
 * subjects that can be moved to their organisation graph. Do this, e.g., on
 * rebooting the service.
 *
 * When `processDeletes` set to false: same as before but only for inserts. Use
 * this for scheduling after a succesful `processInserts` to see if some more
 * data can be moved to their organisation graph now.
 *
 * Not all data can be moved to the organisation graph at once because the path
 * to the organisation might not be complete, so it sticks around in the
 * temporary graph. Every time a new delta has been processed succesfully, we
 * should check if any of sticking data now has a completed link to the
 * organisation and can be moved.
 *
 * @public
 * @async
 * @function
 * @param {Boolean} [processDeletes = true] - Whether to also look for deletes or
 * not.
 * @returns {Object} An object with properties `inserts` and `deletes` with the
 * contents of the results from `dispatch` and `deleteTriples` respectively.
 */
export async function scanAndProcess(processDeletes = true) {
  let deletesResults = [];
  if (processDeletes) {
    //Deletes
    const deletes = await sts.getTriplesAndAllGraphs(
      namedNode(env.TEMP_GRAPH_DELETES),
    );
    deletesResults = await deleteTriples(deletes, false);
  }

  //Inserts
  const subjectsWithTypes = await getInsertSubjectsWithType();
  const insertsResults = await dispatch(subjectsWithTypes);

  return {
    inserts: insertsResults,
    deletes: deletesResults,
  };
}

///////////////////////////////////////////////////////////////////////////////
// Helpers
///////////////////////////////////////////////////////////////////////////////

/**
 * Queries the triplestore to fetch the type of every given subject.
 *
 * @async
 * @function
 * @param {Iterable} subjects - A collection of subject.
 * @returns {Array(Object(subject: NamedNode, type: NamedNode))} An array of
 * JavaScript objects with the subject and type as RDF.JS NamedNode terms.
 */
async function getTypesForSubjects(subjects) {
  const response = await mas.querySudo(`
    ${env.SPARQL_PREFIXES}
    SELECT DISTINCT ?subject ?type WHERE {
      ?subject rdf:type ?type .
      VALUES ?subject {
        ${subjects.map(rst.termToString).join(' ')}
      }
    }`);
  const parser = new sjp.SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  return parsedResults;
}

/**
 * Execute query fetching all unique subjects in the temporary insert graph and
 * their type (from anywhere in the triplestore).
 *
 * @see getTypesForSubjects
 * @async
 * @function
 * @returns {Array(Object(subject: NamedNode, type: NamedNode))} An array of
 * JavaScript objects with the subject and type as RDF.JS NamedNode terms.
 */
async function getInsertSubjectsWithType() {
  const response = await mas.querySudo(`
    ${env.SPARQL_PREFIXES}
    SELECT DISTINCT ?subject ?type WHERE {
      GRAPH ${rst.termToString(namedNode(env.TEMP_GRAPH_INSERTS))} {
        ?subject ?p ?o .
      }
      ?subject rdf:type ?type .
    }`);

  const parser = new sjp.SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  return parsedResults;
}

/**
 * Get, for each triple in the given store, all the graphs this triple can be
 * found in. E.g. a triple to be deleted can be found in the temporary deletes
 * graph and in a certain organisation graph. Find all of the occurences of
 * this triple and return it as a single data store.
 *
 * @async
 * @function
 * @param {N3.Store} store - Store containing the triples that need to be
 * searched for. The graphs are ignored.
 * @returns {N3.Store} Store with the same triple repeated with a different
 * graph for every graph it can be found in.
 */
async function getGraphsForTriples(store) {
  const values = [];
  store.forEach((triple) => {
    //Add the values with and without the explicit string typing.
    values.push(
      `(${rst.termToString(triple.subject)} ${rst.termToString(
        triple.predicate,
      )} ${rst.termToString(triple.object)})`,
    );
    if (triple.object?.datatype?.value === ns.xsd`string`.value)
      values.push(
        `(${rst.termToString(triple.subject)} ${rst.termToString(
          triple.predicate,
        )} ${sts.formatTerm(triple.object)})`,
      );
  });
  const response = await mas.querySudo(`
    SELECT DISTINCT ?s ?p ?o ?g WHERE {
      VALUES (?s ?p ?o) {
        ${values.join('\n')}
      }
      GRAPH ?g {
        ?s ?p ?o .
      }
    }`);
  const parser = new sjp.SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  const resultStore = new N3.Store();
  parsedResults.forEach((res) => {
    resultStore.addQuad(res.s, res.p, res.o, res.g);
  });
  return resultStore;
}

/**
 * For a given subject of a given type, finds the query that should form a path
 * to the administrative unit that should be the container of that data. Query
 * the triplestore to get the UUID of that administrative unit and return all
 * results if they can be found. Multiple paths could be found, and thus,
 * technically, multiple unique UUIDs could be returned.
 *
 * @async
 * @function
 * @param {NamedNode} subject - A given subject that needs to be resolved to an
 * administrative unit.
 * @param {NamedNode} type - The type matching the subject, used for searching
 * for the correct path to the administrative unit.
 * @returns {Array(Literal)} An array with literals containing the unique UUIDs
 * of the administrative units.
 */
async function getOrganisationUUIDs(subject, type) {
  //Find correct query from a config with `type`
  let organisationUUIDs = new Set();
  for (const pathConfig of pta) {
    if (pathConfig.type.value === type.value) {
      let queryMunicipalityName = `?association <http://www.w3.org/ns/org#hasPrimarySite>/<https://data.vlaanderen.be/ns/organisatie#bestaatUit>/<https://data.vlaanderen.be/ns/adres#gemeentenaam> ?gemeentenaam .`
      if("https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#Vereniging" === type.value){
         queryMunicipalityName = `?subject <http://www.w3.org/ns/org#hasPrimarySite>/<https://data.vlaanderen.be/ns/organisatie#bestaatUit>/<https://data.vlaanderen.be/ns/adres#gemeentenaam> ?gemeentenaam .`
      }
      const response = await mas.querySudo(`
        ${env.SPARQL_PREFIXES}
        SELECT DISTINCT ?adminUnitUuid WHERE {
          BIND (${rst.termToString(subject)} AS ?subject) .
          ${pathConfig.pathToAssociation}
          ${queryMunicipalityName}

          ?bestuurseenheid <http://www.w3.org/ns/org#classification>/<http://www.w3.org/2004/02/skos/core#prefLabel> "Gemeente" ;
                          <http://data.vlaanderen.be/ns/besluit#werkingsgebied> ?werkingsgebied ;
                          <http://mu.semte.ch/vocabularies/core/uuid> ?adminUnitUuid .

          ?werkingsgebied a <http://www.w3.org/ns/prov#Location> ;
                          <http://www.w3.org/2000/01/rdf-schema#label> ?gemeentenaam .


        }`);
      const parser = new sjp.SparqlJsonParser();
      const parsedResults = parser
        .parseJsonResults(response)
        .map((o) => o.adminUnitUuid.value);
      parsedResults.forEach((i) => organisationUUIDs.add(i));
    }
  }
  console.log(organisationUUIDs)
  return [...organisationUUIDs];
}






/**
 * Moves all triples for a given subject from the given original graph to the
 * target graph. Done via a workaround that involves first getting all the data
 * for the subject, formatting the data with explicit datatypes (as another
 * workaround for weirdly explicit delta data and Virtuoso's specific datatype
 * handling), and removing data triple by triple in separate queries.
 *
 * @async
 * @function
 * @param {NamedNode} subject - The subject all data needs to be moved from.
 * @param {NamedNode} originalGraph - Graph where data will be searched in and
 * removed.
 * @param {Iterable(NamedNode)} targetGraph - Collection (Array, iterator, ...)
 * of graphs where the data should end up in.
 * @return {undefined} Nothing
 */
async function moveSubjectBetweenGraphs(subject, originalGraph, targetGraphs) {
  //Get all data for this subject
  const data = await sts.getDataForSubject(subject, originalGraph);
  //Insert it in all target graphs (all at once)
  for (const targetGraph of targetGraphs)
    await sts.insertData(data, targetGraph);
  //Remove triples without literals or untyped literals
  const literalTriples = [];
  data.forEach((quad) => {
    if (quad.object.termType === 'Literal') literalTriples.push(quad);
  });
  data.removeQuads(literalTriples);
  await sts.deleteData(data, originalGraph);

  //Remove triples with typed literals, one by one, due to a bug in Virtuoso
  for (const triple of literalTriples) {
    const deleteStore = new N3.Store();
    deleteStore.addQuad(triple);
    await sts.deleteData(deleteStore, originalGraph);
  }
}

/**
 * Transforms a collection of changesets with inserts and deletes into a
 * collection of bundled inserts and deletes, making sure not to mix the
 * ordering between deletes and inserts. Ordering between inserts and between
 * deletes is not maintained. This is still OK for processing in order.
 *
 * @function
 * @param {Iterable} changesets - A regular collection of changesets.
 * @returns {Array(Object)} Very similar to the changesets argument. This is an
 * array of objects with only inserts or only deletes.
 */
function flattenChangesets(changesets) {
  const flattens = [];
  for (const changeset of changesets) {
    const latest = flattens[flattens.length - 1];
    if (changeset.deletes.length > 0) {
      if (!latest || latest.deletes.length <= 0) {
        flattens.push({
          inserts: [],
          deletes: changeset.deletes,
        });
      } else if (latest.deletes.length > 0) {
        latest.deletes = latest.deletes.concat(changeset.deletes);
      }
    }
    if (changeset.inserts.length > 0) {
      if (!latest || latest.inserts.length <= 0) {
        flattens.push({
          inserts: changeset.inserts,
          deletes: [],
        });
      } else if (latest.inserts.length > 0) {
        latest.inserts = latest.inserts.concat(changeset.inserts);
      }
    }
  }
  return flattens;
}
