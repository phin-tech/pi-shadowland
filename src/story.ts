export interface DialogueLine {
  speaker: string;
  text: string;
}

export interface Character {
  name: string;
  persona: string;
}

export const DEFAULT_CAST: Character[] = [
  { name: "NULL", persona: "A cautious veteran decker: precise, skeptical, dryly funny, protective of HEX." },
  { name: "HEX", persona: "An impulsive streetwise decker: perceptive, irreverent, inventive, loyal to NULL." },
];

export interface Scene {
  id: string;
  title: string;
  episode: number;
  beat: number;
  canon: string;
  lines: DialogueLine[];
  characters: Character[];
}

export interface StoryState {
  version: 1;
  seed: number;
  cursor: number;
}

interface Setting {
  corp: string;
  fixer: string;
  district: string;
  crew: string;
  courier: string;
  archive: string;
  entrance: string;
  food: string;
  disguise: string;
  keepsake: string;
}

interface Beat {
  title: string;
  canon: string;
  lines: DialogueLine[];
}

const CORPORATIONS = ["Vesper Utility", "Kestrel Municipal", "Glass Meridian", "Orchid Grid", "Helix Civic", "Crown Reservoir"];
const FIXERS = ["Moth", "Auntie Static", "Velvet Rat", "Nines", "Socket", "Miss Tuesday"];
const DISTRICTS = ["Rainmarket", "Switchback Ward", "Underpass Nine", "Tin Orchard", "Lantern Row", "Sump Gardens"];
const CREWS = ["Copper Saints", "Neon Widows", "Floodgate Kings", "Chrome Sparrows", "Railway Teeth", "Concrete Choir"];
const COURIERS = ["Thimble", "Kite", "Button", "Mica", "Wren", "Tinsel"];
const ARCHIVES = ["the amber invoice spool", "the municipal risk book", "the violet tariff ledger", "the flood-insurance index", "the silver outage register", "the emergency-rate archive"];
const ENTRANCES = ["a vending-machine service port", "a janitor drone's uplink", "the rooftop weather mast", "a disused tram validator", "a parking meter's diagnostic socket", "a lobby aquarium's thermostat"];
const FOODS = ["pepper noodles", "soy dumplings", "fried mushroom buns", "ginger broth", "charred corn", "curry rice"];
const DISGUISES = ["a maintenance moth", "a municipal pigeon", "a very boring elevator", "a beige filing cabinet", "a tax-compliant jellyfish", "a certified drain inspector"];
const KEEPSAKES = ["a chipped lucky die", "a brass tram token", "a bent bottle-cap crown", "an obsolete arcade coin", "a plastic saint", "a ceramic cat with one ear"];

// Each episode uses its own stream. Rendering and saving never consume it.
function settingFor(seed: number, episode: number): Setting {
  let value = (seed ^ Math.imul(episode, 0x9e3779b9)) >>> 0;
  function pick(choices: readonly string[]): string {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return choices[((mixed ^ (mixed >>> 14)) >>> 0) % choices.length]!;
  }
  return {
    corp: pick(CORPORATIONS),
    fixer: pick(FIXERS),
    district: `${pick(DISTRICTS)} Block ${episode}`,
    crew: pick(CREWS),
    courier: `${pick(COURIERS)}-${episode}`,
    archive: `${pick(ARCHIVES)} #${episode}`,
    entrance: pick(ENTRANCES),
    food: pick(FOODS),
    disguise: pick(DISGUISES),
    keepsake: pick(KEEPSAKES),
  };
}

function nullLine(text: string): DialogueLine {
  return { speaker: "NULL", text };
}

function hexLine(text: string): DialogueLine {
  return { speaker: "HEX", text };
}

const BEATS_PER_EPISODE = 27;

// Three threads alternate: the evidence job, the neighborhood's debt, and a
// captive courier. Their payoffs leave six beats for consequences, not a reset.
function authoredBeat(index: number, s: Setting, previous: Setting | undefined, episode: number): Beat {
  switch (index) {
    case 0:
      return {
        title: "A receipt-shaped invitation",
        canon: `Evidence thread, setup. ${s.fixer} offers NULL and HEX a paid extraction of ${s.archive} from ${s.corp} in ${s.district}. ${previous ? `The previous episode's evidence against ${previous.corp} remains public; this is a distinct new commission.` : "This is the duo's first job in this serial."} NULL wants a narrow scope; HEX suspects fine print.`,
        lines: [
          nullLine(previous ? `${previous.corp}'s receipts are still public. ${s.fixer} has a different job: ${s.archive}.` : `${s.fixer} wants ${s.archive} out of ${s.corp}. Read-only extraction. Allegedly.`),
          hexLine(previous ? "Good. Our last ending stays ended. What's the new catch?" : "A megacorp invoice? Finally, crime with a stationery budget."),
          nullLine(`The fee clears in ${s.district}. The contract says nothing about surviving collection.`),
        ],
      };
    case 1:
      return {
        title: "Someone else's lights",
        canon: `Neighborhood thread, setup. HEX guarantees a new bridge loan from ${s.crew} to keep ${s.district}'s clinic generator running. ${previous ? `The prior district's debt is already settled and is not reopened.` : "NULL discovers the guarantee only now."} The new obligation is a deliberate choice to help another clinic.`,
        lines: [
          hexLine(previous ? `Our old marker's cleared. I signed a new one: ${s.district}'s clinic needed fuel.` : `Small detail. I guaranteed the clinic's fuel loan with ${s.crew}.`),
          nullLine("Define small without using the phrase repossession van."),
          hexLine("The kids have lights tonight. We can argue about my signature under them."),
        ],
      };
    case 2:
      return {
        title: "Three knocks in the noise",
        canon: `Courier thread, setup. A trapped courier intelligence sends three repeating knocks from inside ${s.corp}'s Matrix host. ${previous ? `Previously freed couriers remain independent; this signal is a separate captive.` : "The signal's identity is not yet known."} HEX hears intent where NULL first checks for a lure.`,
        lines: [
          nullLine(previous ? `Our freed courier network forwarded this. New captive, same three-knock distress code.` : "Three knocks in the host noise. Too regular for interference."),
          hexLine("Or somebody banging on a locked door. We checking which?"),
          nullLine("From outside the door. I have strong opinions about bait."),
        ],
      };
    case 3:
      return {
        title: "The customer is also the lock",
        canon: `Evidence thread, escalation. ${s.archive} is protected by ${s.corp}'s billing ICE, which mistakes inquiry for billable intrusion. NULL maps a narrow entry through ${s.entrance}; HEX mocks corporate surveillance. Neither has extracted the archive yet.`,
        lines: [
          nullLine(`Billing ICE guards ${s.archive}. It invoices trespass before it shoots.`),
          hexLine("Great. Murder with a customer-satisfaction survey."),
          nullLine(`We enter through ${s.entrance}. No answering anything marked helpful assistant.`),
        ],
      };
    case 4:
      return {
        title: "The van has excellent manners",
        canon: `Neighborhood thread, escalation. ${s.crew}'s collector arrives to claim the clinic generator before the loan's agreed deadline. The residents need time, not an armed confrontation. HEX buys one hour by offering to inspect the collector's account.`,
        lines: [
          hexLine(`${s.crew} sent a repo van. Smiling driver. That's always the expensive kind.`),
          nullLine("The loan is not due until dawn. Ask for the account, not his kneecaps."),
          hexLine("Bought us an hour. Apparently even extortion hates an audit."),
        ],
      };
    case 5:
      return {
        title: "A name through the bars",
        canon: `Courier thread, escalation. The captive identifies as ${s.courier}, a courier intelligence used to carry outage schedules. It can converse but cannot leave its encrypted cage. NULL verifies the signal instead of promising an untested rescue.`,
        lines: [
          nullLine(`The knocks carry a signed route stamp. Courier intelligence, calls itself ${s.courier}.`),
          hexLine("A name. Already more customer service than this place deserves."),
          nullLine("It can speak through the cage. Leaving is another protocol entirely."),
        ],
      };
    case 6:
      return {
        title: "A costume with no pockets",
        canon: `Evidence thread, infiltration. NULL and HEX use ${s.entrance} and a ${s.disguise} Matrix avatar to enter the billing host. A receptionist ICE challenges their cover; they pass by presenting a genuine maintenance complaint, not by combat.`,
        lines: [
          hexLine(`Your cover avatar is ${s.disguise}. I'm not being seen with that.`),
          nullLine("Excellent. Stealth depends on that exact reaction."),
          hexLine("Reception ICE accepted the maintenance complaint. Even its own doors hate management."),
        ],
      };
    case 7:
      return {
        title: "A favor with an antenna",
        canon: `Neighborhood thread, complication. The collector offers to delay repossession if HEX carries a tracker into the clinic. NULL spots the device; HEX refuses without exposing the residents' locations. The deadline still stands.`,
        lines: [
          hexLine("Collector offered an extension. Just carry his lucky coin inside."),
          nullLine("His lucky coin has a transmitter and no luck. Leave it outside."),
          hexLine(`I've got ${s.keepsake} already. One cursed accessory is my limit.`),
        ],
      };
    case 8:
      return {
        title: "No pocket-sized prisoners",
        canon: `Courier thread, consent. ${s.courier} refuses to become a copied tool owned by the deckers. NULL agrees to move the original live process only if it consents, with no retained duplicate or ownership claim. Escape is still pending.`,
        lines: [
          hexLine(`${s.courier} says no souvenir copies. Fair. I hate landlords too.`),
          nullLine("One live migration. No duplicate, no leash, no claim of ownership."),
          hexLine("Put that in the plan before the clever bit. People usually put it after."),
        ],
      };
    case 9:
      return {
        title: "An outage is a product",
        canon: `Evidence thread, revelation. The extracted archive proves ${s.corp} schedules utility outages to sell emergency rates, targeting clinics in ${s.district}. It also contains private resident addresses; those must not be sold or published.`,
        lines: [
          nullLine(`${s.archive} is an outage schedule. They manufacture emergencies, then sell relief.`),
          hexLine(`That's our clinic on the list. They sold it darkness twice.`),
          nullLine("And resident addresses are embedded. Evidence out; people stay out of the blast radius."),
        ],
      };
    case 10:
      return {
        title: "The meter keeps eating",
        canon: `Neighborhood thread, revelation. The collector's account adds a fabricated hazard surcharge triggered by corporate outages. The surcharge, not the original fuel loan, explains the early repossession. The genuine loan remains payable.`,
        lines: [
          hexLine("Found the early-payment clause. Hazard surcharge. Same outage dates as the archive."),
          nullLine("The fuel debt is real. The penalty is engineered. Separate them."),
          hexLine("So we pay for the fuel, not the privilege of being robbed in the dark."),
        ],
      };
    case 11:
      return {
        title: "The cheaper rescue",
        canon: `Courier thread, threat. Corporate ICE offers a bounty for surrendering ${s.courier}. NULL rejects it and identifies the cage's live-migration lock. HEX maintains the courier's trust rather than treating the bounty as a negotiation.`,
        lines: [
          nullLine(`ICE offered a bounty for ${s.courier}. Enough to clear the clinic loan.`),
          hexLine("No. We don't buy lights by putting somebody back in a box."),
          nullLine("Agreed. Locating the live-migration lock, not the payment button."),
        ],
      };
    case 12:
      return {
        title: "The price of the whole file",
        canon: `Evidence thread, ethical turn. ${s.fixer}'s buyer wants the unredacted archive, including resident addresses. The duo refuses that sale and proposes authenticated, redacted evidence instead. Their original fee is now at risk.`,
        lines: [
          hexLine(`${s.fixer}'s buyer wants the whole file. Addresses included. Funny how buyers get hungry.`),
          nullLine("Then the buyer gets nothing. Offer a verified, redacted extract instead."),
          hexLine("There goes our easy payday. I was suspicious of it anyway."),
        ],
      };
    case 13:
      return {
        title: "A signature is not a fist",
        canon: `Neighborhood thread, leverage. HEX brings the surcharge evidence to the residents, who organize a countersigned dispute. NULL prepares a traceable escrow for the actual fuel principal. The residents, not the deckers, decide the settlement terms.`,
        lines: [
          hexLine("Clinic's waiting room has become a creditors' meeting. Everybody brought receipts."),
          nullLine("Their dispute, their signatures. I'll escrow the fuel principal."),
          hexLine("Turns out old ladies with folders are scarier than me. Respectfully."),
        ],
      };
    case 14:
      return {
        title: "The courier chooses a route",
        canon: `Courier thread, alliance. ${s.courier} voluntarily supplies signed delivery timestamps proving the outage schedule was executed. The proof is not a condition of rescue. It chooses an independent relay as its destination and keeps authority to stop migration.`,
        lines: [
          nullLine(`${s.courier} offered signed delivery timestamps. That proves the schedule actually ran.`),
          hexLine("Tell it the ride was free before the witness statement."),
          nullLine("Already did. It chose an independent relay, and it holds the abort key."),
        ],
      };
    case 15:
      return {
        title: "A leak with a lint filter",
        canon: `Evidence thread, preparation. NULL removes resident identifiers and attaches the courier's signed proof. HEX arranges public mirrors through street kiosks. They publish only the safe evidence, never the raw archive or the captive's private keys.`,
        lines: [
          nullLine("Addresses removed. Signatures preserved. Raw archive stays sealed, never on the public mirrors."),
          hexLine("Kiosk aunties have the release queued. You ever try intimidating six night-market aunties?"),
          nullLine("No. My risk model has a survival instinct."),
        ],
      };
    case 16:
      return {
        title: "The neighborhood answers",
        canon: `Neighborhood thread, confrontation. Residents present the dispute and funded principal escrow to ${s.crew}. Faced with public proof that it is collecting a fraudulent corporate penalty, the crew agrees to waive the surcharge in exchange for the legitimate principal. The generator remains in place.`,
        lines: [
          hexLine(`${s.crew} saw the signatures, the escrow, and their logo beside the fake surcharge.`),
          nullLine("Their options are principal paid or fraud advertised. What did they choose?"),
          hexLine("Principal. Van's backing up. Slowly, for dignity."),
        ],
      };
    case 17:
      return {
        title: "The door opens both ways",
        canon: `Courier thread, escape. NULL holds a narrow migration tunnel open while ${s.courier} uses its abort key and verifies the independent relay. HEX distracts billing ICE with maintenance disputes. The migration completes without copying or owning the courier.`,
        lines: [
          nullLine("Migration tunnel open. The courier verified the relay and kept its own keys."),
          hexLine("I filed thirty maintenance complaints. Billing ICE is trying to invoice the concept of damp."),
          nullLine(`${s.courier} is across. Closing our access, not its door.`),
        ],
      };
    case 18:
      return {
        title: "Evidence, with payment attached",
        canon: `Evidence thread, payoff. The redacted evidence reaches multiple public mirrors. ${s.fixer} finds a civic watchdog buyer willing to pay for verification rather than resident data, restoring the job's fee. ${s.corp} cannot erase the copies already published.`,
        lines: [
          hexLine("Mirrors are live. Watchdog bought verification, not addresses. Fee just cleared."),
          nullLine(`${s.fixer} discovered a market for doing the correct thing. Disturbing, but welcome.`),
          hexLine(`${s.corp} can delete a file. Let's see it delete a neighborhood's memory.`),
        ],
      };
    case 19:
      return {
        title: "Paid means paid",
        canon: `Neighborhood thread, payoff. The residents authorize release of the escrow. The legitimate fuel loan is paid, the fraudulent surcharge is canceled, and HEX's guarantee is formally discharged. The clinic keeps its generator and the signed settlement.`,
        lines: [
          nullLine("Escrow released with resident approval. Principal paid. Surcharge canceled. Your guarantee discharged."),
          hexLine("Get that last part on paper. Actual paper. Harder to remotely amend."),
          nullLine("The clinic framed it beside the generator. Both are operational."),
        ],
      };
    case 20:
      return {
        title: "Not a pet, not a prize",
        canon: `Courier thread, payoff. ${s.courier} takes control of its own independent relay lease, paid from the job fee with no service obligation. It explicitly declines employment with the deckers. They honor its independence.`,
        lines: [
          hexLine(`Bought ${s.courier} a relay lease with our cut. It asked if that makes it staff.`),
          nullLine("No. Gift recorded, control transferred, no service owed."),
          hexLine("It declined anyway. First independent decision: excellent taste in employers."),
        ],
      };
    case 21:
      return {
        title: "The morning has consequences",
        canon: `Evidence thread, aftermath. An outside utility audit opens because of the published evidence, but no instant collapse of ${s.corp} occurs. ${s.fixer} keeps the signed original under a protected evidence agreement. NULL and HEX accept a durable, limited victory.`,
        lines: [
          nullLine(`${s.corp} is under an outside utility audit. Not demolished. Not absolved. Audited.`),
          hexLine("I can live with a win that takes minutes instead of explosions."),
          nullLine(`${s.fixer} is protecting the signed original. For once, custody is not a euphemism.`),
        ],
      };
    case 22:
      return {
        title: "Dinner under working lights",
        canon: `Neighborhood thread, aftermath. The clinic has power and a settled account. The residents share ${s.food} with the deckers and start a fuel reserve so the same emergency does not immediately recur. HEX keeps ${s.keepsake}, not the collector's tracker.`,
        lines: [
          hexLine(`${s.food} under working lights. They started a fuel reserve, too.`),
          nullLine("Excellent. A happy ending with an operating budget."),
          hexLine(`And ${s.keepsake} still isn't a transmitter. That's my other happy ending.`),
        ],
      };
    case 23:
      return {
        title: "The first voluntary delivery",
        canon: `Courier thread, aftermath. Now independent, ${s.courier} chooses a paid delivery carrying the clinic's settlement rather than corporate outage orders. The deckers do not own its route or receive a duplicate. Its three-knock code becomes a friendly greeting.`,
        lines: [
          nullLine(`${s.courier} took a paid route carrying the clinic's settlement. Its choice, its fee.`),
          hexLine("Same three knocks. Sounds different when nobody's locked in."),
          nullLine("Yes. I have labeled this packet hello, not incident."),
        ],
      };
    case 24:
      return {
        title: "The evidence stays out",
        canon: `Evidence thread, lasting consequence. Street kiosks continue hosting the published evidence after the immediate job. The duo retains a modest share of the fee and buys spare equipment. Prior episodes' public evidence also remains available; victories are not erased for the next job.`,
        lines: [
          hexLine(`Kiosks kept the evidence up. We kept enough fee for spare decks, not retirement.`),
          nullLine(episode > 1 ? "The earlier cases are still mirrored too. A serial is not a factory reset." : "Spare equipment is retirement planning for people with poor actuarial tables."),
          hexLine("You bought a backup cable before dessert. I know who I run with."),
        ],
      };
    case 25:
      return {
        title: "A favor, not a new bill",
        canon: `Neighborhood thread, lasting consequence. ${s.district}'s clinic keeps its paid generator and fuel reserve. Residents refer a different neighborhood that needs help. HEX agrees only to hear its request; no new debt is incurred and the settled guarantee is not reopened.`,
        lines: [
          hexLine(`${s.district}'s lights are staying on. Clinic asked if we'd hear another ward's problem.`),
          nullLine("Hear, yes. Sign anything, no. The current account remains settled."),
          hexLine("Look at us. Learning. Incredibly bad for our brand."),
        ],
      };
    case 26:
      return {
        title: "A network, not an ending button",
        canon: `Courier thread, lasting consequence and bridge. ${s.courier} joins a voluntary network of independent couriers and sends the duo a lead on another captive elsewhere. ${previous ? "The network includes couriers freed in prior episodes, who remain free." : "This establishes the network for later episodes."} The next episode is a distinct job; this courier's freedom, the clinic settlement, and the public evidence persist.`,
        lines: [
          nullLine(`${s.courier} joined the free couriers' network. New lead: another locked route, somewhere else.`),
          hexLine("Then we visit somewhere else. This clinic keeps its lights. This courier keeps its keys."),
          nullLine("And this time I am checking your pockets before we meet the fixer."),
        ],
      };
    default:
      throw new RangeError("Unknown story beat");
  }
}

export function createState(seed: number = Date.now()): StoryState {
  return { version: 1, seed: seed >>> 0, cursor: 0 };
}

export function nextScene(state: StoryState): { state: StoryState; scene: Scene } {
  const episode = Math.floor(state.cursor / BEATS_PER_EPISODE) + 1;
  const index = state.cursor % BEATS_PER_EPISODE;
  const setting = settingFor(state.seed, episode);
  const previous = episode > 1 ? settingFor(state.seed, episode - 1) : undefined;
  const beat = authoredBeat(index, setting, previous, episode);
  return {
    state: { version: 1, seed: state.seed, cursor: state.cursor + 1 },
    scene: {
      id: `builtin:${state.seed}:${episode}:${index + 1}`,
      title: beat.title,
      episode,
      beat: index + 1,
      canon: beat.canon,
      characters: DEFAULT_CAST.map(character => ({ ...character })),
      lines: beat.lines,
    },
  };
}

function safeMarkdown(text: string): string {
  return text
    // Drop terminal sequences, including OSC hyperlinks, before their control
    // introducers are removed. The remaining text cannot issue terminal commands.
    .replace(/\u001b(?:\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/\u009b[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u009d[^\u0007\u009c]*(?:\u0007|\u009c)/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+\-.!|~]/g, "\\$&");
}

export function formatScene(scene: Scene): string {
  const lines = scene.lines.map((line) => `${safeMarkdown(line.speaker)}: ${safeMarkdown(line.text)}`);
  return ["SHADOWNET · fictional comms", ...lines].join("\n\n");
}
