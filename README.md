# verenigingen-graph-dispatcher-service

This is a data dispatching service for verenigingen with support for
deletes. Without the deletes, the functionality of this service would be
similar to
[verenigingen-graph-dispatcher-service](https://github.com/lblod/verenigingen-graph-dispatcher-service),
but because deletes need to be processed in a specific way, a new service had
to be written.

## How it works

**Consumer**

This service is quite useless on its own and requires a
[delta-consumer](https://github.com/lblod/delta-consumer) to be configured in a
specific way. When the consumer fetches delta files from a different stack, it
should replay those messages through custom dispatching rules. Deletes are to
be processed first. Those deleted triples are to be _inserted_ in a temporary
deletes graph. Inserts are to be inserted afterwards in another temporary graph
for inserts. Changesets are to be processed and finished in order they appear
in the delta files.

**Delta-notifier**

A [delta-notifier](https://github.com/mu-semtech/delta-notifier) then needs to
forward these triples. In order to keep the inserts separate from the deletes,
the delta-notifier has to send those delta messages to different API paths.
(This could technically be possible on a single API path, but this solution
keeps the code a bit more sane, as the dispatcher service doesn't need to
filter on graph, because the delta-notifier already has those triples separated
by graph.) Deletes and inserts are now posted to the dispatcher as inserts in
different graphs on different paths.

**Locking**

Incoming requests really need to be (as much as possible) processed in order,
and one changeset after the other. This service uses a lock to make sure only
one request is being processed at the time. The request from the delta-notifier
is closed as soon as the request is being addressed.

**Deletes**

When deletes come in as inserts to the temporary deletes graph, they are
quickly remodelled to look like actual deletes for internal use. For every
triple in the deletes, the graphs are fetched from the triplestore. This shows
in which (organisation) graphs the data exists. If it only exists in one
organisation graph, except for the temporary inserts and deletes graphs, the
triple can successfully be removed from _all_ those locations (including the
temporary graphs). If the triple is found in more than one organisation graph,
it can not be removed because it is impossible to know which organisation
ordered the removal of the triple. _This is a limitation._ Also, if the triple
is found in other unrelated graphs, it is also removed. **TODO:** this
behaviour might need to be adjusted.

**Inserts**

Incoming inserts need to be moved to their respective organisation graph. For
every inserted triple, the type (`rdf:type`) for the subject is fetched from
the triplestore and this is used to find a possible correct data path to the
administrative unit. This path is queried in the triplestore and if an
organisation UUID can be retrieved, it is used to construct the organisation
graph to move all data of that subject to. When data is moved, it is removed
from the temporary graphs. The paths to the administrative unit are configured
in a separate file. Look at the section about configuration below for more
info.

After at least one successful move of data, a process is scheduled to scan over
the inserts graph to try to move new subjects to their organisation graph. This
needs to be done because it might not be possible to immediately move all
pieces of data to the correct graph on first ingestion. The path to the
administrative unit might not be completed yet due to data that is slowly
seeping in from the consumer. Any successful move of data means that a new part
of a path to an administrative unit has been constructed. A full scan of the
inserts graph is needed to pick subjects that now have a complete path and can
be moved.

**Service restarts and manual dispatching**

When this service restarts, say after a failure or other unexpected outage, it
starts an autonomous scan through the temporary inserts and deletes graph to
try and move as many subjects or execute as many deletes possible. This same
process can be manually triggered by an API call (see the section about the API
below).

This leads to another limitation: which inserts come before which deletes? When
the service has crashed, it has potentially missed out on a number of delta
messages. Missing out on those means that all information on the ordering of
those triples is lost. It is impossible to reconstruct the ordering of the
changesets. This problem is somewhat mitigated by the fact that triples are
mostly unique (the same triple is not likely to be duplicated in different
graphs), and that data is usually not inserted and deleted (or vice versa) in a
short amount of time.

## Adding to a stack

To make use of this service, add it to a mu-semtech stack by placing the
following code snippet in the `docker-compose.yml` file to define a new
service.

```yaml
dispatcher-verenigingen:
  image: lblod/verenigingen-graph-dispatcher-service:1.0.0
```

This service consumes delta-messages to react to data inserted in the temporary
inserts and temporary deletes graphs. The following snippet demonstrates that,
and this snippet can be added to the delta-notifier's configuration.

```javascript
{
  match: {
    graph: {
      type: 'uri',
      value: 'http://associations-consumer/temp-inserts'
    }
  },
  callback: {
    url: 'http://dispatcher-associations/delta-inserts',
    method: 'POST'
  },
  options: {
    resourceFormat: 'v0.0.1',
    gracePeriod: 0,
    ignoreFromSelf: true,
  }
},
{
  match: {
    graph: {
      type: 'uri',
      value: 'http://associations-consumer/temp-deletes'
    }
  },
  callback: {
    url: 'http://dispatcher-associations/delta-deletes',
    method: 'POST'
  },
  options: {
    resourceFormat: 'v0.0.1',
    gracePeriod: 0,
    ignoreFromSelf: true,
  }
}
```

Make sure that the hostname from the `callback.url` matches the hostname of
this dispatcher service.

## API

All these API paths return a `200 OK` as soon as the request is handled. This
is before the data is processed, but after all preceding data has been
processed.

### POST `/delta-inserts`

Used to wire the delta-notifier. This is where delta messages about inserts
should be posted.

### POST `/delta-deletes`

Used to wire the delta-notifier. This is where delta messages about deletes
should be posted.

### POST `/manual-dispatch`

Used for manually starting a process that goes through the data in the inserts
and deletes graphs to move as much data as possible. Could be used for
debugging, or for periodic cleanup attempts.

## Configuration

### Environment variables

These are environment variables that can be used to configure this service.
Supply a value for them using the `environment` keyword in the
`docker-compose.yml` file.

- `TEMP_GRAPH_PREFIX`: _(optional, default:
  "http://eredienst-mandatarissen-consumer/temp")_ This URI is appended with
  `-inserts` and `-deletes` to construct the graphs for the temporary inserts
  and deletes respectively. These graphs should be used by the delta-consumer
  to insert data into and are used here to scan for data that can be moved to
  some organisation graph or data that can be deleted. This service also
  deletes data from these graphs.
- `ORGANISATION_GRAPH_PREFIX`: _(optional, default:
  "http://mu.semte.ch/graphs/organizations/")_ This URI is used to construct
  the organisation graph by appending the UUID of the organisation that was
  found. This variable is also used to check if a graph is an organisation
  graph.
- `LOGLEVEL`: _(optional, default: "silent")_ Possible values are `["error", "info", "silent"]`. On `silent`, no errors or informational messages are
  printed. On `error`, only error messages are printed to the console. On
  `info`, both error messages and informational messages such as data
  processing results are printed.
- `WRITE_ERRORS`: _(optional, default: "false", boolean)_ Indicates if errors
  need to be written to the triplestore.
- `ERROR_GRAPH`: _(optional, default: "http://lblod.data.gift/errors")_ Graph
  in the triplestore in which to write errors.
- `ERROR_BASE`: _(optional, default: "http://data.lblod.info/errors/")_ URI
  base for constructing the subject of new Error individuals.

### Paths to administrative unit

Some default paths are provided in the `config/pathsToAdministrativeUnit.js`
file. These should be sufficient to move all data about associations to
the correct organisation graph. If needed, this file can be overridden by
mounting a file with the same name in the same folder via a mount in the
`docker-compose.yml` file. For example:

```yaml
dispatcher-worship-mandates:
  image: lblod/worship-positions-graph-dispatcher-service-loket:1.0.0
  volumes:
    - configuration/dispatcher-worship-positions/pathsToAdministrativeUnit.js:/config/pathsToAdministrativeUnit.js
```

This file should have a structure like the one in the following example:

```javascript
import { NAMESPACES as ns } from '../env';
export default [
  {
    type: ns.ere`EredienstMandataris`,
    pathToWorshipAdminUnit: `
      ?subject
        org:holds ?mandate .
      ?orgaanInTime
        org:hasPost ?mandate ;
        mandaat:isTijdspecialisatieVan ?orgaan .
      ?orgaan
        besluit:bestuurt ?worshipAdministrativeUnit .
    `,
  },
  {...},
];
```

The example shows an array of objects with properties `type` and
`pathToWorshipAdminUnit`. `type` is the URI of the `rdf:type` of the subject at
hand that needs to be moved to the organisation graph. `pathToWorshipAdminUnit`
is a part of a SPARQL query where you need to form an RDF path from the
variable `?subject` to the variable `?worshipAdministrativeUnit` which is
supposed to stand for a Bestuurseenheid who's UUID will be part of the
organisation graph.

**NOTE:** You can use RDF prefixes in the SPARQL query and for the types. Take
a look in the `env.js` file for a list of the available prefixes.
