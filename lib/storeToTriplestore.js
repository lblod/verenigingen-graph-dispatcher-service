/**
 * @module storeToStore
 * @description This module provides some utility functions for accessing and
 * storing data from and to the triplestore in combination with RDF.JS
 * libraries.
 * **NOTE:** This is by no means a finished library. It is not to be released
 * on its own except after rigorous testing and completion.
 */

import * as rst from 'rdf-string-ttl'
import * as sjp from 'sparqljson-parse'
import * as mas from '@lblod/mu-auth-sudo'
import * as N3 from 'n3'
import * as env from '../env'
import { NAMESPACES as ns } from '../env'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
/**
 * Query the triplestore to fetch all the data for a given subject.
 *
 * @async
 * @function
 * @param {NamedNode} subject - Use this as the subject to fetch all data in
 * the triplestore.
 * @param {NamedNode} [graph] - Optional. If given, the query is limited to
 * only search through this graph. If not given the query is still executed
 * with a GRAPH clause so that the returned result store has the correct graph
 * values.
 * @returns {N3.Store} A store containing all the data.
 */
export async function getDataForSubject (subject, graph) {
  const allDataResponse = graph
    ? await mas.querySudo(`
      SELECT ?p ?o WHERE {
        GRAPH ${rst.termToString(graph)} {
          ${rst.termToString(subject)} ?p ?o .
        }
      }`)
    : await mas.querySudo(`
      SELECT ?p ?o WHERE {
        GRAPH ?g {
          ${rst.termToString(subject)} ?p ?o .
        }
      }`)
  const parser = new sjp.SparqlJsonParser()
  const parsedResults = parser.parseJsonResults(allDataResponse)
  const store = new N3.Store()
  parsedResults.forEach(triple =>
    store.addQuad(subject, triple.p, triple.o, graph || triple.g)
  )
  return store
}

/**
 * Formats a quad in a Turtle/Notation3-like syntax for use in QPARQL queries.
 * The graph in the quad is ignored.
 *
 * **Please don't use this unless absolutely necessary.**
 * This should produce the same results as a TTL writer, but literals with
 * datatype `xsd:string` in the term in the store, also explicitly have the
 * `^^xsd:string` in the TTL. Regular writers see this as redundant information
 * and don't print the `^^xsd:string`, however, due to the weird(?) behaviour
 * of Virtuoso, we need the type if we want to remove a typed literal from the
 * triplestore, including for strings. This is also because the delta-consumer
 * **always** adds the type to a literal, even for strings where that would be
 * redundant.
 *
 * @function
 * @param {Quad} quad - Quad to be formatted into a Turtle/Notation3 compatible
 * string.
 * @returns {String} String representation of the quad.
 */
export function formatTriple (quad) {
  return `${rst.termToString(quad.subject)} ${rst.termToString(
    quad.predicate
  )} ${formatTerm(quad.object)} .`
}

/**
 * Formats an RDF term into a Turtle/Notation3 compatible string.
 *
 * **NOTE:** special about this function is that it explicitely adds the
 * `^^xsd:string` datatype annotation if it is present in the term to be
 * compatible with Virtuoso in DELETE queries. Prefer regular RDF writer for
 * more comprehensive writing of triples and terms.
 *
 * @function
 * @param {NamedNode} term -
 * @returns {String}
 */
export function formatTerm (term) {
  if (
    term.datatype?.value === 'http://www.w3.org/2001/XMLSchema#string' ||
    term.datatype?.value ===
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
  )
    return `${rst.termToString(term)}^^${rst.termToString(term.datatype)}`
  else return rst.termToString(term)
}

/**
 * Fetches the triples in the given graph from the triplestore.
 *
 * @async
 * @function
 * @param {NamedNode} graph - The graph from which to get the triples from.
 * @returns {N3.Store} Store containing the triples in the graph.
 */
export async function getData (graph) {
  if (!graph)
    throw new Error(
      'Querying without graph is probably a mistake as it will cause an explosion of data and is therefore not allowed.'
    )
  const response = await mas.querySudo(`
    SELECT ?s ?p ?o WHERE {
      GRAPH ${rst.termToString(graph)} {
        ?s ?p ?o .
      }
    }
  `)
  const parser = new sjp.SparqlJsonParser()
  const parsedResults = parser.parseJsonResults(response)
  const store = new N3.Store()
  parsedResults.forEach(triple =>
    store.addQuad(triple.s, triple.p, triple.o, graph)
  )
  return store
}

/**
 * Get all triples from a certain graph and also find all the graphs each
 * triple can be found in. Each triple in the resulting store can thus appear
 * multiple times, but with different graphs.
 *
 * @public
 * @async
 * @function
 * @param {NamedNode} graph - The graph from which to get the triples from.
 * @returns {N3.Store} Store containing the triples in the graph and those same
 * triples from other graphs if they also exist there.
 */
export async function getTriplesAndAllGraphs (graph) {
  if (!graph)
    throw new Error(
      'Querying without graph is probably a mistake as it will cause an explosion of data and is therefore not allowed.'
    )
  const response = await mas.querySudo(`
    SELECT ?s ?p ?o ?g WHERE {
      GRAPH ${rst.termToString(graph)} {
        ?s ?p ?o .
      }
      GRAPH ?g {
        ?s ?p ?o .
      }
    }`)
  const parser = new sjp.SparqlJsonParser()
  const parsedResults = parser.parseJsonResults(response)
  const resultStore = new N3.Store()
  parsedResults.forEach(res => {
    resultStore.addQuad(res.s, res.p, res.o, res.g)
  })
  return resultStore
}

/**
 * Inserts the data from a store into the graphs defined in the data or in the
 * given graph.
 *
 * @async
 * @function
 * @param {N3.Store} store - Store of data to be inserted in the triplestore.
 * @param {NamedNode} [graph] - Optional. If given ignore the graph information
 * in the quads and insert the triple in this graph. Otherwise, use the
 * internal graph information to put the triples in.
 * @returns {undefined} Nothing
 */
export async function insertData (store, graph) {
  const insertFunction = async (store, graph) => {
    await sleep(env.SLEEP_BETWEEN_BATCHES)
    const writer = new N3.Writer()
    store.forEach(q => writer.addQuad(q.subject, q.predicate, q.object))
    const triplesSparql = await new Promise((resolve, reject) =>
      writer.end((error, result) => {
        if (error) reject(error)
        else resolve(result)
      })
    )
    await mas.updateSudo(
      `INSERT DATA {
        GRAPH ${rst.termToString(graph)} {
          ${triplesSparql}
        }
      }`,
      {
        'mu-call-scope-id': 'http://associations-graph-dispatcher/update'
      }
    )
  }

  if (store.size < 1) return
  if (graph) await insertFunction(store, graph)
  else
    for (const graph of store.getGraphs()) {
      const triples = store.getQuads(undefined, undefined, undefined, graph)
      await insertFunction(triples, graph)
    }
}

/**
 * Deletes given data from the triplestore. Deletes from the given graph only
 * or deletes from the graph embedded in the quad.
 *
 * @async
 * @function
 * @param {N3.Store} store - Store with data that needs to be deleted.
 * @param {NamedNode} [graph] - Optional. If given, only remove data from that
 * graph, other wise use graph embedded in the quad.
 * @returns {undefined} Nothing
 */
export async function deleteData (store, graph) {
  const deleteFunction = async (store, graph) => {
    await sleep(env.SLEEP_BETWEEN_BATCHES)
    const triples = [...store]
    let batchSize = env.BATCH_SIZE
    const originalBatchSize = env.BATCH_SIZE
    let start = 0
    while (start < triples.length) {
      try {
        const batch = triples.slice(start, start + batchSize)
        await deleteTriplesFromGraphWithoutBatching(graph, batch)
        start += batchSize
        batchSize = originalBatchSize
      } catch (err) {
        if (batchSize > 1) {
          batchSize = Math.ceil(batchSize / 2)
        } else {
          const tripleString = [
            rst.termToString(triples[start].subject),
            rst.termToString(triples[start].predicate),
            rst.termToString(triples[start].object)
          ].join(' ')
          throw new Error(
            err,
            `The following triple could not be removed from the triplestore:\n\t${tripleString}\nThis might be because of a network issue, a syntax issue or because the triple is too long.`
          )
        }
      }
    }
  }

  if (store.size < 1) return
  if (graph) await deleteFunction(store, graph)
  else
    for (const graph of store.getGraphs()) {
      const triples = store.getQuads(undefined, undefined, undefined, graph)
      await deleteFunction(triples, graph)
    }
}

/**
 * Deletes an N3 Store from the triplestore. Due to a bug in Virtuoso, this
 * function deletes typed literals one by one in separate queries as a
 * workaround.
 *
 * @public
 * @async
 * @function
 * @param {NamedNode} graph - Target graph where the triples should be deleted
 * from.
 * @param {N3.Store|Iterable} store - Store or other iterable collection
 * containing the data that needs to be removed.
 * @returns {undefined} Nothing. (Might return the response object of a REST
 * call to the triplestore to remove the data.)
 */
async function deleteTriplesFromGraphWithoutBatching (graph, store) {
  if (store.size && store.size <= 0) return
  if (store.length && store.length <= 0) return
  //Use a proper writer for when the data is properly formatted.
  const writer = new N3.Writer()
  store.forEach(q => writer.addQuad(q.subject, q.predicate, q.object))
  const triplesSparql1 = await new Promise((resolve, reject) =>
    writer.end((error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  )
  await mas.updateSudo(
    `DELETE DATA {
      GRAPH ${rst.termToString(graph)} {
        ${triplesSparql1}
      }
    }`,
    {
      'mu-call-scope-id': 'http://associations-graph-dispatcher/update'
    }
  )

  //Also use a self made writer to format the triples in a special way for
  //Virtuoso. Only do this when dealing with explicit string typed terms. Do
  //this in a separate query to deal with another Virtuoso bug.
  //Slightly less reliable and more verbose, but keeping the datatype is
  //necessary for Virtuoso to be able to delete the data. Another bug?
  const triplesSparql = []
  store.forEach(quad => {
    if (quad.object?.datatype?.value === ns.xsd`string`.value)
      triplesSparql.push(formatTriple(quad))
  })
  if (triplesSparql.length)
    await mas.updateSudo(
      `DELETE DATA {
        GRAPH ${rst.termToString(graph)} {
          ${triplesSparql.join('\n')}
        }
      }`,
      {
        'mu-call-scope-id': 'http://associations-graph-dispatcher/update'
      }
    )
}
