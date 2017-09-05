# Principles of the Brave Ledger (0.8.40)
The Brave Ledger is a BTC-based micropayments system for users and publishers.

To begin to understand the Ledger,
it's helpful to understand a few concepts from the
[Brave Vault](https://github.com/brave/vault/blob/master/documentation/Vault-Principles.md).
In particular,
a _persona_ is an anonymous identity -- it identifies a set of browsing behaviors without actually knowing who you are.

From the Ledger's perspective,
the most important property of a persona is the value of its `Bravery` setting.
At present,
there is one possible value, `ad-free`.
If the browsing experience is `ad-free`,
then third-party advertisements are not displayed by the browser.

## Behavior

Accounting interactions with consumers are:

- anonymous: Brave Software should not be able to correlate publisher visits with contributions; and,

- accountable: Brave Software should be able to reconcile contributions and publisher visits _only_ on an aggregated basis.

Note that payments to personas and publishers are made to verified BTC wallets,
even though the publisher visits of each persona is anonymous.
(Each persona's browsing history remains private.)

### Who Funds Whom
There are two ways in which "money enters the system":

- a persona with a `Bravery` setting of `ad-free` makes a periodic contribution; and,

- an advertiser makes a payment commensurate with the aggregate impressions of advertisements served by Brave Software.

At present, there is one way in which "money leaves the system":
a publisher receives a share of the aggregated contributions associated with
the viewing habits of personas who visit that publisher's site.

Of course,
Brave Software receives a percentage of the payments entering the system.

In order for either a persona or publisher to be paid,
they must have a verified wallet.
Brave Software oversees the verification process (though it may use third-parties for this purpose).
There are different rules for verification for personas and publishers:

- very small amounts are transferred to personas --
so verification (whilst necessary) is lightweight
(e.g., verification by "ownership" of an email address and a phone number);
in contrast,
- potentially large amounts are transferred to publishers --
so verification is more extensive,
depending on the size and frequency of payments,
e.g., similar to the verification spectrum seen for
[DV, OV, and EV certificates](https://cabforum.org/info-for-consumers/).

## Model
The client is responsible for reconciling persona behavior with the Ledger.
(However,
Brave Software's advertising and accounting servers provide the usual checks for click fraud, etc.)

The default `Bravery` setting for the client is `ad-free`.
If `ad-free` is selected by the user,
then,
depending on the configuration of the client:
the user may select a fixed contribution amount,
or select an amount from a list of choices,
or enter an amount (subject to an upper limit),
or select a "no contribution" option.

### Authorized, but Anonymous, Transactions
The Brave Ledger uses [Anonize2](https://anonize.org/assets/technology.html) in order to process authorized but anonymous
transactions.
This anonymization process allows the client and Brave Ledger to authoritatively agree on behavior without linking that
behavior to personas, browsers, or wallets.

Although "the math" behind Anonize2 is _rather complicated_,
its operational properties are straight-forward:

1. There are two servers: a "registrar" and a "surveyor"

2. A client contacts the registrar,
downloads its public key.

3. The client generates its own public and private keys,
constructs a request containing a unique identifier and a cryptographic proof based on the registrar's public key and the
client's secret key,
and sends the request to the registrar.

4. If the registrar "likes" the request,
it sends back an "intermediate result" that allows the client to construct a "master user token",
which it can then use when making requests to the surveyor.

Whenever the client sends a request to the surveyor:

1. The client sends the unique identifier to the surveyor,
and the surveyor sends back an "intermediate result".

2. The client delays an unpredictable amount of time (to avoid timing correlation attacks).

3. Using its own secret key and the result from the surveyor,
the client generates a "one-time unlinkable token" and uses that to sign a request to the surveyor.

4. When the surveyor examines the request,
it is able to determine that the signature was from a user that is authorized by the registrar; however --
and this is the _really clever_ part --
the surveyor is not able to determine which authorized user generated the request.
However,
the surveyor is able to determine whether the request is a duplicate.

Of course,
this is a very simplistic explanation of how Anonize2 works.
If you'd like more details,
here are two excellent technical papers and a pointer to an open source repository:

* [An Overview of ANONIZE: A Large-Scale Anonymous Survey System](https://anonize.org/assets/anonize-ieee-special.pdf),
IEEE Security and Privacy Magazine, 2015.

* [ANONIZE: A Large-Scale Anonymous Survey System](https://anonize.org/assets/anonize-oak-camera.pdf),
Oakland Security and Privacy Conference, 2014.

* [abhi/anonize2](https://gitlab.com/abhvious/anonize2)

### Ad-Free: Statistical Voting
Earlier versions of this document used "fractional" voting for allocating contributions to publishers.
For example,
if site "X" has twice as many publisher views as site "Y" for a particular contribution,
then site "X" should receive twice as much of that contribution as site "Y".
This raises a privacy issue in that it groups sites (and relative weights) together allowing for fingerprinting analysis.

This version of the document uses "statistical" voting instead.
The client makes the contribution,
associating with it a unique `viewingId`.
This `viewingId` is used to a create a credential with a Viewing registrar,
and is given the identities of one or more Voting registrars that will authorize the `viewingId` to cast a ballot.
Each ballot contains a single publisher identity.

As with fractional voting,
the client calculates the relative weights of publisher views for each site.
Then,
for each of the Voting registrars that it is authorized to use,
it selects a publisher identity using an unpredictable, but weighted, algorithm.
For example,
if site "X" has twice as many publisher views as site "Y" for a particular contribution,
then site "X" should be twice as likely to be selected for a ballot as site "Y".
 (statistically) it should be twice as likely to be selected

<img src='ad-free.png' />

