// GENERATED FILE — do not edit by hand. Regenerate with `node scripts/build-indec-index.mjs`.
//
// INDEC localidad codes, vendored from georef-ar (Ministerio del Interior, datos.gob.ar) so a lookup
// needs no network call and no database. One row per unique province / name / code triple, sorted,
// tab-separated, newline-delimited:
//
//   - `provincia` — INDEC 2-digit province code (NOT ARCA's `idProvincia`; see `ar-geography.ts`).
//   - `nombre` — the place name verbatim from the catalog, accents and all. Normalization happens at
//     lookup time (`normalize-locality.ts`), so this file stays a faithful copy of the source.
//   - `codigo` — the 8-digit INDEC localidad censal code (provincia 2 + departamento 3 + localidad 3).
//
// Both localidades censales and BAHRA asentamientos are indexed, the latter projected up to the
// localidad censal containing them — so a rural entidad or paraje resolves to its localidad's code.
// A name that maps to more than one code within its province is ambiguous and is dropped when the
// lookup index is built; it is kept here because the ambiguity is a property of the catalog, not of us.
//
// **Known coverage gap: urban barrios.** BAHRA models settlements, not neighbourhoods, so a barrio of an
// interior city (ARCA regularly reports one — `BARRIO YAPEYU` for a Córdoba address) is simply not in
// here and its address resolves to no code. The one exception is CABA, whose 48 barrios georef does carry,
// every one of them pointing at the single localidad censal `02000010`. Closing the gap for the rest
// would need a postal-code index, which has no openly-licensed source — see docs/CONTRACT-CHANGES.md.

/**
 * What this snapshot is: when georef-ar was read, and how much of it. Stated in code rather than in a
 * header comment because it is published — `ar-geography.ts` reads {@link INDEC_SNAPSHOT.date} straight
 * into the wire's `cityCodeSchemeVersion` (CONTRACT §5), so a caller holding its own snapshot of the same
 * live dataset can date a mismatch instead of confusing drift with the barrio gap.
 *
 * Regenerating rewrites this and the rows together, which is the point: neither can go stale alone.
 *
 * The block below is the **one** thing in this file written by hand rather than by the generator, and only
 * once: the rows were fetched on 2026-08-25 and core diffed its own catalog against them that day, finding
 * the two code sets identical. Re-running the generator to mint the stamp would have fetched a genuinely
 * newer snapshot and dated it today, throwing away the baseline that makes a version worth publishing.
 * Every regeneration from here writes it.
 */
export const INDEC_SNAPSHOT = {
    /** ISO date georef-ar was read. */
    date: '2026-08-25',
    /** Localidades censales read — and, by the generator's own assertion, the distinct codes below. */
    localidadesCensales: 4027,
    /** BAHRA asentamientos read, each projected up to the localidad censal containing it. */
    asentamientos: 14673,
    /** Rows below — unique province/name/code triples, so several names can share one code. */
    nameRows: 4930,
} as const;

// Annotated `: string` on purpose, which is why the inferrable-types rule is off for this one line:
// without the annotation TypeScript infers the literal type and copies all 4930 rows into
// the emitted `.d.ts`, tripling what ships for no benefit.
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const INDEC_LOCALITY_ROWS: string = `02	Agronomía	02000010
02	Almagro	02000010
02	Balvanera	02000010
02	Barracas	02000010
02	Belgrano	02000010
02	Boca	02000010
02	Boedo	02000010
02	Caballito	02000010
02	Chacarita	02000010
02	Ciudad Autónoma de Buenos Aires	02000010
02	Ciudad de Buenos Aires	02000010
02	Coghlan	02000010
02	Colegiales	02000010
02	Constitución	02000010
02	Flores	02000010
02	Floresta	02000010
02	Liniers	02000010
02	Mataderos	02000010
02	Monserrat	02000010
02	Monte Castro	02000010
02	Nueva Pompeya	02000010
02	Nuñez	02000010
02	Palermo	02000010
02	Parque Avellaneda	02000010
02	Parque Chacabuco	02000010
02	Parque Chas	02000010
02	Parque Patricios	02000010
02	Paternal	02000010
02	Puerto Madero	02000010
02	Recoleta	02000010
02	Retiro	02000010
02	Saavedra	02000010
02	San Cristóbal	02000010
02	San Nicolás	02000010
02	San Telmo	02000010
02	Versalles	02000010
02	Villa Crespo	02000010
02	Villa Devoto	02000010
02	Villa General Mitre	02000010
02	Villa Lugano	02000010
02	Villa Luro	02000010
02	Villa Ortúzar	02000010
02	Villa Pueyrredón	02000010
02	Villa Real	02000010
02	Villa Riachuelo	02000010
02	Villa Santa Rita	02000010
02	Villa Soldati	02000010
02	Villa Urquiza	02000010
02	Villa del Parque	02000010
02	Vélez Sarsfield	02000010
06	11 de Septiembre	06840010
06	12 de Octubre	06588030
06	16 de Julio	06049050
06	17 de Agosto	06651040
06	17 de Agosto	06651100
06	20 de Junio	06427010
06	25 de Mayo	06854100
06	30 de Agosto	06826040
06	9 de Abril	06260010
06	9 de Julio	06588100
06	Abasto	06441030
06	Abbott	06547010
06	Acasusso	06756010
06	Acceso a Lima	06882050
06	Acevedo	06623010
06	Achupallas	06021050
06	Adela	06218070
06	Adolfo Gonzales Chaves	06014010
06	Adrogué	06028010
06	Aeropuerto Internacional Ezeiza	06270010
06	Aguas Verdes	06420020
06	Agustina	06413010
06	Agustina	06413020
06	Agustín Mosconi	06854010
06	Agustín Roca	06413010
06	Agustí­n Mosconi	06854010
06	Agustí­n Roca	06413030
06	Alberdi Viejo	06462010
06	Alberti	06021010
06	Aldo Bonzi	06427010
06	Alejandro Korn	06778020
06	Alejandro Petión	06134010
06	Alfredo Demarchi	06588010
06	Almirante Brown	06028010
06	Altamirano	06119010
06	Alvarez Jonte	06655010
06	América	06679010
06	América	06679040
06	Andant	06231010
06	Antonio Carboni	06483010
06	Aparicio	06189010
06	Arana	06441030
06	Arboledas	06231020
06	Arenas Verdes	06476010
06	Arenaza	06469010
06	Argerich	06875010
06	Ariel	06049010
06	Arrecifes	06077010
06	Arribeños	06294010
06	Arroyo Corto	06700010
06	Arroyo Dulce	06714010
06	Arroyo Venado	06399010
06	Arroyo de la Cruz	06266010
06	Arturo Seguí	06441030
06	Asamblea	06112010
06	Ascensión	06294020
06	Atalaya	06505010
06	Atlántida	06518060
06	Avellaneda	06035010
06	Ayacucho	06042010
06	Azcuénaga	06728010
06	Azopardo	06651010
06	Azucena	06791060
06	Azul	06049020
06	Bahía Blanca	06056010
06	Bahía San Blas	06602010
06	Bahí­a San Blas	06602010
06	Baigorrita	06385010
06	Bajo Hondo	06182010
06	Balcarce	06063010
06	Balneario Cochicó	06399060
06	Balneario Laguna de Gomez	06413020
06	Balneario Laguna de Gómez	06413030
06	Balneario Los Ángeles	06581080
06	Balneario Orense	06833010
06	Balneario Pehuen Co	06182020
06	Balneario San Cayetano	06742010
06	Balneario Sauce Grande	06553010
06	Banderaló	06392010
06	Banderaó	06392010
06	Banfield	06490010
06	Baradero	06070010
06	Barker	06084010
06	Barrio América Unida	06648010
06	Barrio Banco Provincia	06098010
06	Barrio Cerrado La Mata	06791090
06	Barrio Colinas Verdes	06357120
06	Barrio El Boquerón	06357030
06	Barrio El Carmen Este	06098010
06	Barrio El Carmen Oeste	06441030
06	Barrio El Casal	06357110
06	Barrio El Coyunco	06357120
06	Barrio El Mangrullo	06882060
06	Barrio El Mirador	06119130
06	Barrio El Taladro	06134020
06	Barrio Gambier	06441030
06	Barrio Kennedy	06315010
06	Barrio La Gloria	06357120
06	Barrio Las Casuarinas	06497060
06	Barrio Las Golondrinas	06119020
06	Barrio Las Malvinas	06441030
06	Barrio Las Margaritas	06686060
06	Barrio Las Plantaciones	06119100
06	Barrio Las Quintas	06441030
06	Barrio Lisandro de la Torre y Santa Marta	06525020
06	Barrio Lomas Altas	06218030
06	Barrio Los Bosquecitos	06119030
06	Barrio Los Pioneros (Barrio Tavella)	06126010
06	Barrio Los Pioneros (Barrio Tavella)	06126020
06	Barrio Morabo	06364030
06	Barrio Parque General San Martín	06371010
06	Barrio Parque Las Acacias	06119040
06	Barrio Ruta 24 Kilómetro 10	06364030
06	Barrio Río Salado	06343010
06	Barrio Rí­o Salado	06343040
06	Barrio Saavedra	06882050
06	Barrio San Cayetano	06218010
06	Barrio San Esteban - Barrio Los Pozos	06134030
06	Barrio Santa Paula	06357060
06	Barrio Universitario	06098010
06	Bartolomé Bavio	06505020
06	Base Aeronaval Punta Indio	06655050
06	Batán	06357070
06	Bayauca	06469020
06	Bella Vista	06760010
06	Bellocq	06147010
06	Belén de Escobar	06252010
06	Benavídez	06805010
06	Benito Juárez	06084020
06	Benítez	06224080
06	Berazategui	06091010
06	Berazategui Oeste	06091010
06	Berdier	06714020
06	Berisso	06098010
06	Bermúdez	06469030
06	Bermúdez	06469100
06	Bernal	06658010
06	Bernal Oeste	06658010
06	Berutti	06826010
06	Billinghurst	06371010
06	Blancagrande	06595020
06	Blaquier	06277010
06	Bocayuva	06616010
06	Bordenave	06651020
06	Bosques	06274010
06	Boulogne Sur Mer	06756010
06	Bragado	06112010
06	Bragado	06112020
06	Burzaco	06028010
06	Béccar	06756010
06	Cabildo	06056020
06	Cacharí	06049030
06	Cadret	06147020
06	Calderón	06182070
06	Camet	06357110
06	Camet Norte	06518060
06	Campana	06126020
06	Camping Magdalena	06505060
06	Campo de Mayo	06760010
06	Campos Salles	06763050
06	Campos de Roca	06119110
06	Canning	06260010
06	Canning	06270010
06	Capilla del Señor	06266050
06	Capitán Castro	06609010
06	Capitán Sarmiento	06140010
06	Carapachay	06861010
06	Cardenal Cagliero	06602020
06	Carhué	06007010
06	Cariló	06644010
06	Carlos Beguerie	06693010
06	Carlos Casares	06147030
06	Carlos Keen	06497010
06	Carlos Keen	06497020
06	Carlos María Naón	06588020
06	Carlos Salas	06469030
06	Carlos Salas	06469040
06	Carlos Spegazzini	06270010
06	Carlos Tejedor	06154010
06	Carlos Tomás Sourigues	06091010
06	Carmen de Areco	06161010
06	Carmen de Patagones	06602030
06	Casalins	06630010
06	Casalins	06630020
06	Casbas	06399020
06	Cascada	06203010
06	Caseros	06840010
06	Castelar	06568010
06	Castelli	06168010
06	Castilla	06210010
06	Castilla	06210050
06	Cazon	06707020
06	Cazón	06707030
06	Cañada Seca	06392020
06	Cañada Seca	06392030
06	Cañuelas	06134030
06	Cañuelas	06134040
06	Centinela del Mar	06280050
06	Centro Guerrero	06168020
06	Cerro de la Gloria	06168030
06	Chacabuco	06210010
06	Chacabuco	06210020
06	Chacras de Olivia	06882070
06	Chacras de Villa Espil	06728080
06	Chacras de la Tinidad	06134100
06	Chacras del Paraná	06882080
06	Chapadmalal	06357080
06	Chapalco	06875110
06	Chas	06301030
06	Chascomús	06218010
06	Chasicó	06819010
06	Chiclana	06609100
06	Chillar	06049040
06	Chivilcoy	06224010
06	Churruca	06840010
06	City Bell	06441030
06	Ciudad Evita	06427010
06	Ciudad Jardín El Libertador	06371010
06	Ciudad Jardín Lomas del Palomar	06840010
06	Ciudad del Libertador General San Martín	06371010
06	Ciudadela	06840010
06	Claraz	06581010
06	Claromecó	06833020
06	Claypole	06028010
06	Club de Campo Las Malvinas	06119140
06	Club de Campo Los Puentes	06497060
06	Club de Pesca Pigüé	06819110
06	Club de Pesca Saavedra	06700090
06	Colonia Hinojo	06595060
06	Colonia Mauricio	06147040
06	Colonia Nievas	06595040
06	Colonia San Adolfo	06875100
06	Colonia San Martíi­n	06700080
06	Colonia San Martín	06700020
06	Colonia San Miguel	06595040
06	Colonia San Miguel	06595050
06	Colonia San Miguel Arcángel	06007020
06	Colonia San Ricardo	06351010
06	Colonia Seré	06154020
06	Colón	06175010
06	Comandante Nicanor Otamendi	06280010
06	Comodoro Py	06112020
06	Comodoro Py	06112030
06	Conesa	06763010
06	Conesa	06763020
06	Copetonas	06833030
06	Coronel Boerr	06455010
06	Coronel Brandsen	06119050
06	Coronel Charlone	06392030
06	Coronel Charlone	06392050
06	Coronel Dorrego	06189030
06	Coronel Granada	06351050
06	Coronel Martínez de Hoz	06469050
06	Coronel Martí­nez de Hoz	06469040
06	Coronel Pringles	06196010
06	Coronel Seguí	06021020
06	Coronel Suárez	06203020
06	Coronel Vidal	06518010
06	Cortines	06497060
06	Costa Bonita	06581040
06	Costa Esmeralda	06420050
06	Country Club Bosque Real	06364030
06	Country Club Las Praderas	06497060
06	Cristiano Muerto	06742040
06	Crotto	06798010
06	Crucesita	06035010
06	Cuartel V	06560010
06	Cucullú	06728020
06	Curamalal	06203030
06	Curarú	06154030
06	D'Orbigny	06203040
06	Daireaux	06231030
06	Darregueira	06651030
06	De Bary	06616020
06	De La Garma	06014020
06	De la Canal	06791010
06	Del Carril	06707030
06	Del Carril	06707040
06	Del Valle	06854020
06	Del Viso	06412010
06	Del Viso	06638040
06	Delfín Huergo	06007030
06	Dennehy	06588070
06	Diego Gaynor	06266060
06	Dique Luján	06805010
06	Dique N° 1	06245010
06	Divisadero	06315020
06	Dock Sud	06035010
06	Dolores	06238010
06	Domselaar	06778020
06	Don Bosco	06658010
06	Don Cipriano	06218080
06	Don Orione	06028010
06	Don Torcuato Este	06805010
06	Don Torcuato Oeste	06805010
06	Dudignac	06588040
06	Dufaur	06700020
06	Dufaur	06700030
06	Duggan	06735010
06	Dunamar	06833020
06	Eduardo O'Brien	06112040
06	El Cazador	06252010
06	El Chajá	06266120
06	El Destino	06466020
06	El Divisorio	06196020
06	El Dorado	06462020
06	El Jagüel	06260010
06	El Libertador	06840010
06	El Malacate	06266130
06	El Marquesado	06357090
06	El Palomar	06568010
06	El Paraíso	06665010
06	El Paraí­so	06665010
06	El Pato	06091010
06	El Pensamiento	06196030
06	El Perdido	06189040
06	El Provincial	06588120
06	El Remanso	06266060
06	El Retiro	06441030
06	El Salvaje	06868030
06	El Talar	06805010
06	El Trigo	06455020
06	El Triunfo	06469050
06	El Triunfo	06469060
06	El Tropezón	06274010
06	El socorro	06623130
06	Elvira	06483020
06	Emilio Ayarza	06224020
06	Emilio V. Bunge	06392040
06	Energí­a	06581030
06	Ensenada	06245010
06	Erezcano	06763020
06	Erize	06651090
06	Ernestina	06854030
06	Erézcano	06763040
06	Escalada	06882030
06	Escobar	06252010
06	Espartillar	06007040
06	Espartillar	06700030
06	Espartillar	06700040
06	Espigas	06595050
06	Espigas	06595060
06	Estacion Chapadmalal	06357100
06	Estación Arenales	06294030
06	Estación Camet	06357110
06	Estación Chapadmalal	06357100
06	Estancia Las Lilas	06497090
06	Estanislao Severo Zeballos	06274010
06	Esteban Agustín Gascón	06007050
06	Esteban Echeverría	06260010
06	Estela	06651040
06	Estela	06651050
06	Ezeiza	06270010
06	Ezpeleta	06658010
06	Ezpeleta Oeste	06658010
06	Facundo Quiroga	06588010
06	Faro	06189050
06	Felipe Solá	06651050
06	Felipe Solá	06651060
06	Ferré	06294040
06	Florencio Varela	06274010
06	Florentino Ameghino	06277020
06	Florida	06861010
06	Florida Oeste	06861010
06	Fontezuela	06623020
06	Fontezuela	06623140
06	Fortíi­n Acha	06462030
06	Fortín Acha	06462030
06	Fortín Olavarría	06679020
06	Fortín Tiburcio	06413040
06	Fortí­n Olavarría	06679010
06	Fortí­n Tiburcio	06413040
06	Francisco A. Berra	06547040
06	Francisco Madero	06609030
06	Francisco Madero	06609080
06	Francisco Álvarez	06560010
06	Franklin	06728030
06	French	06588060
06	Frente Mar	06518060
06	Fulton	06791070
06	Fátima	06638040
06	Gahan	06714030
06	Gardey	06791030
06	Garré	06399030
06	Garré Norte	06826070
06	Garín	06252010
06	General Alvear	06287010
06	General Arenales	06294050
06	General Belgrano	06301010
06	General Conesa	06812010
06	General Daniel Cerri	06056030
06	General Guido	06308010
06	General Hornos	06329010
06	General Hornos	06329050
06	General Juan Madariaga	06315010
06	General La Madrid	06322010
06	General Las Heras	06329010
06	General Las Heras	06329020
06	General Lavalle	06336010
06	General Lavalle	06336020
06	General Mansilla	06505020
06	General O'Brien	06112030
06	General Pacheco	06805010
06	General Pinto	06351020
06	General Pirán	06518020
06	General Rivas	06784010
06	General Rodri­guez	06364030
06	General Rodríguez	06364030
06	General Rojo	06763010
06	General Rojo	06763030
06	General San Martín	06371010
06	General Villegas	06392050
06	General Villegas	06392060
06	Gerli	06035010
06	Gerli	06434010
06	Germania	06351030
06	Girodias	06826020
06	Glew	06028010
06	Gobernador Castro	06770010
06	Gobernador Julio A. Costa	06274010
06	Gobernador Udaondo	06134040
06	Gobernador Udaondo	06134060
06	Gobernador Ugarte	06854040
06	Goldney	06532010
06	González Catán	06427010
06	González Moreno	06679020
06	González Moreno	06679030
06	Gorchs	06301020
06	Gorostiaga	06224030
06	Gowland	06532010
06	Gowland	06532020
06	Goyena	06700040
06	Goyena	06700050
06	Grand Bourg	06515010
06	Gregorio de Laferrere	06427010
06	Grünbein	06056010
06	Guaminí	06399040
06	Guanaco	06609090
06	Guernica	06648010
06	Guerrico	06623030
06	Guillermo Enrique Hudson	06091010
06	Gómez	06119060
06	Günther	06351040
06	Haedo	06568010
06	Hale	06105010
06	Henderson	06406010
06	Herrera Vegas	06406020
06	Hilario Ascasubi	06875030
06	Hinojo	06595060
06	Hinojo	06595070
06	Hortensia	06147050
06	Huanguelén	06203050
06	Hurlingham	06408010
06	Indio Rico	06196040
06	Ingeniero Adolfo Sourdeaux	06515010
06	Ingeniero Juan Allan	06274010
06	Ingeniero Maschwitz	06252010
06	Ingeniero Moneta	06770020
06	Ingeniero Pablo Nogués	06515010
06	Ingeniero Thompson	06847010
06	Ingeniero White	06056010
06	Inocencio Sosa	06609020
06	Inés Indart	06714040
06	Irala	06112040
06	Irala	06112050
06	Iraola	06791080
06	Irene	06189060
06	Iriarte	06351010
06	Irineo Portela	06070020
06	Isidro Casanova	06427010
06	Isla Santiago	06245010
06	Ituzaingo	06410010
06	Ituzaingó	06410010
06	Ituzaingó Centro	06410010
06	Ituzaingó Sur	06410010
06	Jeppener	06119070
06	Joaquín Gorina	06441030
06	Jorge Born	06532030
06	Jose C. Paz	06412010
06	José B. Casas	06602040
06	José C. Paz	06412010
06	José Hernández	06441030
06	José Ingenieros	06840010
06	José Juan Almeyra	06574010
06	José María Ezeiza	06270010
06	José Melchor Romero	06441030
06	José Mármol	06028010
06	Juan A. Pradere	06602050
06	Juan A. de la Peña	06623040
06	Juan Anchorena	06623050
06	Juan Bautista Alberdi	06462040
06	Juan Cousté	06875040
06	Juan E. Barra	06014030
06	Juan F. Ibarra	06105020
06	Juan F. Salaberry	06112060
06	Juan José Paso	06609030
06	Juan José Paso	06609040
06	Juan María Gutiérrez	06091010
06	Juan N. Fernández	06581030
06	Juan N. Fernández	06581040
06	Julio Arditi	06505070
06	Junín	06413050
06	Juní­n	06413050
06	Kilómetro 314	06420080
06	La Angelita	06294060
06	La Armonía	06518030
06	La Armoní­a	06518030
06	La Aurora	06588050
06	La Baliza	06518050
06	La Beba	06686010
06	La Caleta	06518050
06	La Capilla	06274010
06	La Carreta	06826030
06	La Catalina	06497070
06	La Choza	06329020
06	La Choza	06329030
06	La Colina	06322020
06	La Constancia	06042020
06	La Cumbre	06441030
06	La Delfina	06385020
06	La Emilia	06763030
06	La Emilia	06763040
06	La Federala	06483070
06	La Gruta	06819060
06	La Invencible	06714050
06	La Larga	06231040
06	La Limpia	06112050
06	La Limpia	06112070
06	La Lonja	06638040
06	La Lucila	06861010
06	La Luisa	06140020
06	La Macarena	06266140
06	La Manuela	06231060
06	La Matanza	06427010
06	La Niña	06588050
06	La Pala	06007060
06	La Plata	06441030
06	La Reja	06560010
06	La Rica	06224040
06	La Sofía	06147060
06	La Tablada	06427010
06	La Trinidad	06294070
06	La Unión	06270010
06	La Violeta	06623060
06	La Viruta	06655060
06	Labardén	06308020
06	Lago Parque La Salada	06875090
06	Laguna Alsina	06399050
06	Laguna Vitel	06218060
06	Laguna de Lobos	06483030
06	Lanus	06434010
06	Lanús	06434010
06	Lanús Este	06434010
06	Lanús Oeste	06434010
06	Laplacette	06413060
06	Laprida	06448010
06	Lartigau	06196050
06	Las Armas	06511010
06	Las Bahamas	06665020
06	Las Carabelas	06686020
06	Las Encadenadas	06700070
06	Las Flores	06455030
06	Las Marianas	06574020
06	Las Martinetas	06322030
06	Las Toninas	06420010
06	Las Toscas	06469060
06	Las Toscas	06469070
06	Las Vizcachas	06266150
06	Leandro N. Alem	06462050
06	Lezama	06466010
06	Lezica y Torrezuri	06497060
06	Libertad	06539010
06	Licenciado Matienzo	06476020
06	Lima	06882030
06	Lima	06882040
06	Lin Calel	06833040
06	Lincoln	06469070
06	Lincoln	06469080
06	Lisandro Olmos	06441030
06	Llavallol	06490010
06	Lobería	06476030
06	Loberí­a	06476030
06	Lobos	06483040
06	Loma Escondida	06497080
06	Loma Hermosa	06840010
06	Loma Verde	06252010
06	Loma Verde	06343010
06	Loma Verde	06343020
06	Lomas de Zamora	06490010
06	Lomas del Mirador	06427010
06	Longchamps	06028010
06	Los Angeles	06210030
06	Los Cachorros	06638040
06	Los Cardales	06126010
06	Los Cardales	06266070
06	Los Eucaliptus	06189100
06	Los Hornos	06441030
06	Los Indios	06686030
06	Los Naranjos	06505030
06	Los Pinos	06063020
06	Los Polvorines	06515010
06	Los Talas	06098010
06	Los Toldos	06385030
06	Los Ángeles	06210020
06	Lucas Monteverde	06854050
06	Lucila del Mar	06420020
06	Luis Guillón	06260010
06	Luján	06497020
06	Luján	06497060
06	Líbano	06322040
06	López	06084030
06	López Lecube	06651060
06	López Lecube	06651070
06	Magdala	06609040
06	Magdala	06609050
06	Magdalena	06505040
06	Maipú	06511020
06	Malvinas Argentinas	06028010
06	Malvinas Argentinas	06515010
06	Manuel B. Gonnet	06441030
06	Manuel B. Gonnet	06588060
06	Manuel J. Cobo	06466020
06	Manuel Ocampo	06623070
06	Manzanares	06638040
06	Manzone	06638040
06	Maquinista F. Savio Este	06252010
06	Maquinista F. Savio Oeste	06638040
06	Mar Azul	06868010
06	Mar Chiquita	06518040
06	Mar de Ajó	06420020
06	Mar de Ajó - San Bernardo	06420020
06	Mar de Ajó Norte	06420020
06	Mar de Cobo	06518050
06	Mar de las Pampas	06868010
06	Mar del Plata	06357110
06	Mar del Sur	06280020
06	Mar del Tuyú	06420040
06	Marcelino Ugarte	06588070
06	Marcos Paz	06525020
06	Mariano Acosta	06539010
06	Mariano Benítez	06623080
06	Mariano Bení­tez	06623080
06	Mariano H. Alfonzo	06623090
06	Marisol	06189020
06	Martín Coronado	06840010
06	Martín Garcia	06441060
06	Martínez	06756010
06	Martí­n Colman	06672020
06	María Ignacia	06791040
06	Marí­a Ignacia	06791040
06	Massey	06392060
06	Massey	06392070
06	Matheu	06252010
06	Mauricio Hirsch	06147070
06	Mayor Buratovich	06875050
06	Maza	06007070
06	Mechita	06021030
06	Mechita	06112070
06	Mechita	06112080
06	Mechongué	06280030
06	Mercedes	06532020
06	Mercedes	06532040
06	Merlo	06539010
06	Micaela Cascallares	06833050
06	Ministro Rivadavia	06028010
06	Mira Pampa	06679030
06	Mira Pampa	06679040
06	Miramar	06280040
06	Miranda	06672030
06	Moctezuma	06147080
06	Monasterio	06466030
06	Mones Cazón	06609050
06	Mones Cazón	06609060
06	Monte Chingolo	06434010
06	Monte Grande	06260010
06	Monte Hermoso	06553020
06	Montecarlo	06644020
06	Moquehuá	06224050
06	Morea	06588080
06	Moreno	06560010
06	Morse	06413080
06	Morón	06568010
06	Munro	06861010
06	Muñiz	06760010
06	Máximo Paz	06134070
06	Médanos	06875060
06	Napaleofú	06063030
06	Navarro	06574030
06	Necochea	06581040
06	Necochea - Quequen	06581050
06	Necochea - Quequén	06581040
06	Nicanor Olivera	06581050
06	Nicanor Olivera	06581060
06	Norberto de la Riestra	06854060
06	Norumbega	06588090
06	Nueva Plata	06609060
06	Nueva Plata	06609070
06	O'Higgins	06210030
06	O'Higgins	06210040
06	Obligado	06770020
06	Obligado	06770030
06	Ochandio	06742020
06	Ochandío	06742020
06	Olascoaga	06112080
06	Olascoaga	06112090
06	Olavarría	06595070
06	Olavarrí­a	06595080
06	Oliden	06119080
06	Olivera	06497030
06	Olivera	06497070
06	Olivos	06861010
06	Open Door	06497060
06	Ordoqui	06147090
06	Orense	06833060
06	Oriente	06189070
06	Ostende	06644010
06	Pablo Podestá	06840010
06	Pago Chico	06182060
06	Palemón Huergo	06224090
06	Parada Orlando	06266050
06	Parada Orlando	06266080
06	Parada Robles	06266060
06	Parada Robles - Pavón	06266060
06	Parada Robles - Pavón	06266100
06	Paraje La Agraria	06413090
06	Paraje La Ruta	06189080
06	Pardo	06455040
06	Parish	06049060
06	Pasman	06203060
06	Paso del Rey	06560010
06	Pasteur	06469080
06	Pasteur	06469090
06	Patricios	06588110
06	Paula	06105040
06	Pavón	06266060
06	Pavón	06336020
06	Pearson	06175020
06	Pearson	06175030
06	Pedernales	06854070
06	Pedro Luro	06875070
06	Pehuajo	06609070
06	Pehuajó	06609080
06	Pehuen Co	06182020
06	Pelicurá	06819100
06	Pellegrini	06616030
06	Pereyra	06091010
06	Pergamino	06623100
06	Pichincha	06392070
06	Pichincha	06392080
06	Piedritas	06392080
06	Piedritas	06392090
06	Pieres	06476040
06	Pigüé	06700050
06	Pigüé	06700060
06	Pila	06630010
06	Pila	06630020
06	Pilar	06638040
06	Pinamar	06644010
06	Pinzón	06623110
06	Pipinas	06655020
06	Pipinas	06655030
06	Pirovano	06105050
06	Piñeyro	06035010
06	Pla	06021040
06	Playa Dorada	06518060
06	Plomer	06329030
06	Plomer	06329050
06	Plátanos	06091010
06	Polvaredas	06707040
06	Polvaredas	06707050
06	Pontaut	06322050
06	Pontevedra	06539010
06	Porvenir	06277030
06	Posada de los Lagos	06119120
06	Presidente Derqui	06638040
06	Presidente Perón	06648010
06	Pueblo Doyle	06770030
06	Pueblo Doyle	06770040
06	Pueblo Gouin	06161020
06	Pueblo Nuevo	06448020
06	Pueblo San Jorge	06448030
06	Puente Urquiza	06882090
06	Puerto Panal	06882100
06	Punta Alta	06182030
06	Punta Indio	06655030
06	Punta Indio	06655040
06	Punta Lara	06245010
06	Punta Mogotes	06357110
06	Punta Médanos	06420060
06	Puán	06651070
06	Puán	06651080
06	Pérez Millán	06665030
06	Pérez Milán	06665030
06	Quebradas	06070050
06	Quenumá	06721010
06	Quequén	06581040
06	Quilmes	06658010
06	Quilmes Oeste	06658010
06	Rafael Calzada	06028010
06	Rafael Castillo	06427010
06	Rafael Obligado	06686040
06	Ramallo	06665040
06	Ramos Mejía	06427010
06	Ramos Otero	06063040
06	Ramón Biaus	06224060
06	Ramón Santamarina	06581060
06	Ramón Santamarina	06581070
06	Rancagua	06623120
06	Ranchos	06343020
06	Ranchos	06343030
06	Ranelagh	06091010
06	Rauch	06672010
06	Rawson	06210040
06	Rawson	06210050
06	Recalde	06595080
06	Recalde	06595090
06	Remedios de Escalada	06840010
06	Remedios de Escalada de San Martín	06434010
06	Reta	06833070
06	Ricardo Rojas	06805010
06	Rincón de Milberg	06805010
06	Ringuelet	06441030
06	Rivera	06007080
06	Roberto Cano	06686050
06	Roberto J. Payró	06505050
06	Roberto J. Payró	06505080
06	Roberto de Vicenzo	06638040
06	Roberts	06469090
06	Roberts	06469100
06	Rojas	06686060
06	Roosevelt	06679050
06	Roque Pérez	06693020
06	Rosas	06455050
06	Rufino de Elizalde	06441030
06	Ruta 9 Km 107	06882110
06	Río Tala	06770040
06	Rí­o Tala	06770050
06	Saavedra	06700060
06	Saavedra	06700070
06	Saforcada	06413080
06	Saforcada	06413100
06	Saladillo	06707050
06	Salazar	06231050
06	Salazar	06231060
06	Saldungaray	06819050
06	Salliqueló	06721020
06	Salto	06714060
06	Salvador María	06483050
06	Salvador Marí­a	06483050
06	Samborombón	06119090
06	San Agustín	06063050
06	San Andrés de Giles	06728040
06	San Antonio de Areco	06735020
06	San Antonio de Padua	06539010
06	San Bernardo	06420020
06	San Bernardo	06609090
06	San Carlos de Bolívar	06105060
06	San Cayetano	06742030
06	San Clemente del Tuyú	06420030
06	San Emilio	06385040
06	San Enrique	06854080
06	San Esteban	06609020
06	San Fernando	06749010
06	San Francisco Solano	06028010
06	San Francisco Solano	06658010
06	San Francisco de Bellocq	06833080
06	San Germán	06651080
06	San Germán	06651090
06	San Isidro	06756010
06	San José	06028010
06	San José	06203070
06	San Juan Bautista	06274010
06	San Justo	06427010
06	San Manuel	06476050
06	San Mauricio	06679060
06	San Mayol	06833090
06	San Miguel	06760010
06	San Miguel del Monte	06547020
06	San Nicolás de los Arroyos	06763050
06	San Pedro	06770050
06	San Pedro	06770060
06	San Román	06189080
06	San Román	06189090
06	San Sebastián	06224070
06	San Vicente	06778020
06	Sansinena	06679070
06	Santa Clara del Mar	06518060
06	Santa Coloma	06070030
06	Santa Elena	06518060
06	Santa Eleodora	06392020
06	Santa Eleodora	06392090
06	Santa Lucía	06770060
06	Santa Lucía	06770070
06	Santa Luisa	06595090
06	Santa Luisa	06595100
06	Santa María	06203080
06	Santa Regina	06392100
06	Santa Rosa	06134060
06	Santa Teresa	06638040
06	Santa Teresita	06420040
06	Santa Teresita - Mar del Tuyú	06420040
06	Santa Trinidad	06203090
06	Santo Domingo	06511030
06	Santo Tomás	06147100
06	Santos Lugares	06840010
06	Sarandí	06035010
06	Sarasa	06175030
06	Sarasa	06175040
06	Sevigne	06238020
06	Sevigné	06238020
06	Sierra Chica	06595100
06	Sierra Chica	06595110
06	Sierra de la Ventana	06819060
06	Sierra de los Padres	06357120
06	Sierras Bayas	06595110
06	Sierras Bayas	06595120
06	Smith	06147100
06	Smith	06147110
06	Sol de Mayo	06686070
06	Solanet	06042030
06	Solís	06728050
06	Stroeder	06602060
06	Suipacha	06784020
06	Sundblad	06679080
06	Sáenz Peña	06840010
06	Tamangueyú	06476060
06	Tandil	06791050
06	Tapalqué	06798020
06	Tapiales	06427010
06	Tedín Uriburu	06084040
06	Temperley	06490010
06	Teniente Origone	06875080
06	Tigre	06805010
06	Timote	06154040
06	Todd	06077020
06	Tolosa	06441030
06	Tornquist	06819040
06	Tornquist	06819070
06	Torres	06266160
06	Torres	06497050
06	Torres	06497090
06	Tortuguitas	06412010
06	Tortuguitas	06515010
06	Tortuguitas	06638040
06	Transradio	06441030
06	Trenque Lauquen	06826050
06	Tres Algarrobos	06154050
06	Tres Arroyos	06833100
06	Tres Lomas	06847020
06	Tres Picos	06819050
06	Tres Picos	06819080
06	Tres Sargentos	06161030
06	Tres de Febrero	06840010
06	Tristán Suárez	06270010
06	Triunvirato	06469110
06	Troncos del Talar	06805010
06	Trongé	06826060
06	Trujui	06560010
06	Turdera	06490010
06	Udaquiola	06042040
06	Urdampilleta	06105070
06	Uribelarrea	06134070
06	Uribelarrea	06134080
06	Urquiza	06623050
06	Va.Marqués Alejandro María de Aguado	06371010
06	Va.María Irene de los Remedios Escalada	06371010
06	Vagues	06735040
06	Valdés	06854090
06	Valentín Alsina	06434010
06	Valeria del Mar	06644010
06	Vedia	06462060
06	Velloso	06798030
06	Verónica	06655040
06	Verónica	06655050
06	Vicente Casares	06134080
06	Vicente López	06861010
06	Victoria	06749010
06	Vieytes	06505050
06	Vieytes	06505060
06	Villa 7 de Marzo	06602080
06	Villa Adelina	06756010
06	Villa Adelina	06861010
06	Villa Alfredo Fortabat	06595120
06	Villa Alfredo Fortabat	06595130
06	Villa Alsina	06070040
06	Villa Angélica	06623130
06	Villa Argüello	06098010
06	Villa Arrieta	06595110
06	Villa Astolfi	06638040
06	Villa Ayacucho	06371010
06	Villa Ballester	06371010
06	Villa Bernardo Monteagudo	06371010
06	Villa Bordeau	06056010
06	Villa Bosch	06840010
06	Villa Brown	06274010
06	Villa Cacique	06084050
06	Villa Campi	06763040
06	Villa Canto	06763040
06	Villa Castelar	06651100
06	Villa Catela	06245010
06	Villa Centenario	06490010
06	Villa Chacabuco	06371010
06	Villa Coronel José M. Zapiola	06371010
06	Villa Dolores	06098010
06	Villa Domínico	06035010
06	Villa Eduardo Madero	06427010
06	Villa Elisa	06441030
06	Villa Elvira	06441030
06	Villa España	06091010
06	Villa Esperanza	06763060
06	Villa Espil	06728060
06	Villa Espora	06056010
06	Villa Fiorito	06490010
06	Villa Flandria Norte	06497060
06	Villa Flandria Sur	06497060
06	Villa Fournier	06588120
06	Villa Francia	06351040
06	Villa Garibaldi	06441030
06	Villa General Antonio J. de Sucre	06371010
06	Villa General Arias	06182050
06	Villa General Eugenio Necochea	06371010
06	Villa General José Tomás Guido	06371010
06	Villa General Juan G. Las Heras	06371010
06	Villa General Savio	06665050
06	Villa Gesell	06868020
06	Villa Gobernador Udadondo	06410010
06	Villa Godoy Cruz	06371010
06	Villa Granaderos de San Martín	06371010
06	Villa Gregoria Matorras	06371010
06	Villa Grisolía	06021050
06	Villa Independencia	06098010
06	Villa Iris	06651110
06	Villa José León Suárez	06371010
06	Villa Juan Martín de Pueyrredón	06371010
06	Villa La Arcadia	06203100
06	Villa La Florida	06658010
06	Villa La Serranía	06595130
06	Villa La Serraní­a	06595150
06	Villa Laguna La Brava	06063060
06	Villa Libertad	06371010
06	Villa Luzuriaga	06427010
06	Villa Lynch	06371010
06	Villa Lynch Pueyrredón	06105080
06	Villa Lía	06735030
06	Villa Maipú	06371010
06	Villa Manuel Pomar	06175020
06	Villa Manuel Pomar	06175040
06	Villa Manuel Pomar	06686080
06	Villa Margarita	06007100
06	Villa Martelli	06861010
06	Villa María	06021060
06	Villa Moll	06574040
06	Villa Montoro	06441030
06	Villa Nueva	06098010
06	Villa Ortiz	06021070
06	Villa Parque Cecir	06686060
06	Villa Parque Girado	06218030
06	Villa Parque Girado	06218040
06	Villa Parque Presidente Figueroa Alcorta	06371010
06	Villa Parque San Lorenzo	06371010
06	Villa Parque Sicardi	06441030
06	Villa Porteña	06098010
06	Villa Progreso	06098010
06	Villa Raffo	06840010
06	Villa Ramallo	06665060
06	Villa Riccio	06763040
06	Villa Robles	06420070
06	Villa Roch	06812020
06	Villa Rodríguez	06833110
06	Villa Rodrí­guez	06833110
06	Villa Rosa	06638040
06	Villa Roth	06351050
06	Villa Roth (Est. Ingeniero Balbín)	06351060
06	Villa Ruiz	06728070
06	Villa Saboya	06392110
06	Villa San Andrés	06371010
06	Villa San Carlos	06098010
06	Villa San José	06623020
06	Villa San José	06623140
06	Villa San Luis	06274010
06	Villa Santa Rosa	06274010
06	Villa Santos Tesei	06408010
06	Villa Sarmiento	06568010
06	Villa Sauze	06392120
06	Villa Serrana La Gruta	06819040
06	Villa Vatteone	06274010
06	Villa Ventana	06819070
06	Villa Ventana	06819090
06	Villa Yapeyú	06371010
06	Villa Zula	06098010
06	Villa de Mayo	06515010
06	Villa del Mar	06182030
06	Villalonga	06602070
06	Villanueva	06343040
06	Villanueva (Ap. Río Salado)	06343030
06	Villars	06329040
06	Virrey del Pino	06427010
06	Virreyes	06749010
06	Vivoratá	06518070
06	Viña	06077030
06	Vásquez	06014040
06	Warnes	06112090
06	Warnes	06112100
06	Wilde	06035010
06	William C. Morris	06408010
06	Zapiola	06483060
06	Zavalía	06385050
06	Zelaya	06638040
06	Zenón Videla Dorna	06547030
06	Zárate	06882040
06	Zárate	06882050
06	Álvarez Jonte	06655010
06	Álvarez de Toledo	06707010
06	Ángel Etcheverry	06441030
06	Área Reserva Cinturón Ecológico	06035010
06	Área de Promoción El Triángulo	06515010
10	Aconquija	10021060
10	Alijilán	10098010
10	Alto de las Juntas	10021060
10	Amadores	10077010
10	Amanao	10021010
10	Ampolla	10098015
10	Ancasti	10014010
10	Andalgalá	10021020
10	Andalhualá	10091010
10	Anillaco	10105010
10	Anquincila	10014020
10	Antofagasta de la Sierra	10028010
10	Barranca Larga	10035010
10	Bañado de Ovanta	10098020
10	Belén	10035020
10	Buena Vista	10021050
10	Capayán	10042030
10	Casa de Piedra	10070010
10	Casa de Piedra	10091140
10	Chaquiago	10021030
10	Chañar Punco	10091030
10	Choya	10021040
10	Chuchucaruana	10007010
10	Chumbicha	10042040
10	Colana	10084020
10	Colonia Nueva Coneta	10042060
10	Colonia del Valle	10042050
10	Colpes	10007020
10	Colpes	10084030
10	Concepción	10042070
10	Coneta	10042080
10	Copacabana	10105050
10	Corral Quemado	10035040
10	Cóndor Huasi	10035030
10	El Alamito	10021050
10	El Alto	10056010
10	El Aybal	10070020
10	El Bañado	10042090
10	El Bañado	10070030
10	El Bañado	10112040
10	El Bolsón	10007030
10	El Cajón	10091040
10	El Cerrito	10091110
10	El Desmonte	10091050
10	El Divisadero	10070040
10	El Durazno	10035050
10	El Eje	10035055
10	El Hueco	10063040
10	El Lindero	10021060
10	El Pajonal	10084040
10	El Peñón	10028030
10	El Portezuelo	10112010
10	El Potrero	10021070
10	El Puesto	10091060
10	El Puesto	10105090
10	El Quimilo	10070050
10	El Rodeo	10007040
10	El Salado	10105100
10	Esquiú	10070060
10	Famatanca	10091070
10	Farallón Negro	10035060
10	Fiambalá	10105110
10	Fuerte Quemado	10091080
10	Guayamba	10056020
10	Hualfín	10035070
10	Huaycama	10007050
10	Huaycama	10112020
10	Huillapima	10042100
10	Icaño	10070070
10	Infanzón	10056030
10	Isla Larga	10007055
10	Jacipunco	10035080
10	La Candelaria	10014030
10	La Carrera	10063040
10	La Ciénaga	10035085
10	La Dorada	10070080
10	La Estancita	10049050
10	La Falda de San Antonio	10063040
10	La Guardia	10070090
10	La Higuera	10077040
10	La Hoyada	10091090
10	La Majada	10014040
10	La Merced	10077050
10	La Mesada	10021060
10	La Puerta	10007060
10	La Puntilla	10035090
10	La Puntilla	10091140
10	La Puntilla	10105050
10	La Ramadita	10105110
10	La Tercena	10063040
10	La Toma	10035092
10	La Viña	10077060
10	Laguna Blanca	10035095
10	Lampacito	10091030
10	Las Barrancas	10035097
10	Las Cañas	10098030
10	Las Chacritas	10007070
10	Las Esquinas	10070100
10	Las Esquinas	10112027
10	Las Juntas	10007080
10	Las Juntas	10035100
10	Las Lajas	10077070
10	Las Mojarras	10091110
10	Las Palmas	10042105
10	Las Palmitas	10070110
10	Las Tejas	10112030
10	Las Tunas	10098035
10	Lavalle	10098040
10	Londres	10035110
10	Los Altos	10098050
10	Los Angeles	10042110
10	Los Castillos	10007090
10	Los Corrales	10056040
10	Los Nacimientos	10028040
10	Los Nacimientos	10035120
10	Los Talas	10007100
10	Los Varela	10007110
10	Los Ángeles Norte	10042110
10	Los Ángeles Sur	10042110
10	Manantiales	10098060
10	Medanitos	10091030
10	Medanitos	10105130
10	Miraflores	10042120
10	Monte Potrero	10077080
10	Monte Redondo	10098065
10	Mutquin	10084060
10	Palo Blanco	10105140
10	Palo Labrado	10077090
10	Palo Seco	10091140
10	Pampa Blanca	10105110
10	Polcos	10112040
10	Pomancillo Este	10063020
10	Pomancillo Oeste	10063030
10	Pomán	10084070
10	Pozo de Piedra	10035125
10	Pozo del Mistol	10112040
10	Puerta de Corral Quemado	10035130
10	Puerta de San José	10035140
10	Punta de Balasto	10091130
10	Quirós	10070120
10	Ramblones	10070130
10	Recreo	10070140
10	Rincón	10084080
10	San Antonio	10063040
10	San Antonio	10070150
10	San Antonio	10077100
10	San Fernando	10035145
10	San Fernando del Valle de Catamarca	10049030
10	San Isidro	10112040
10	San José	10063040
10	San José	10091140
10	San José Banda	10091070
10	San José Norte	10091140
10	San José Villa	10091140
10	San Martín	10042130
10	San Miguel	10084090
10	San Pablo	10042140
10	San Pedro	10042150
10	San Pedro	10098070
10	Santa Cruz	10112050
10	Santa María	10091150
10	Santa Rosa	10112040
10	Saujil	10084100
10	Saujil	10105160
10	Siján	10084110
10	Singuil	10007120
10	Soledad	10035147
10	Sumalao	10112040
10	Tapso	10056050
10	Tinogasta	10105180
10	Vilismán	10056060
10	Villa Concepcion del Alto	10056010
10	Villa Dolores	10112040
10	Villa Las Pirquitas	10063050
10	Villa Vil	10035150
10	Villa de Balcozna	10077110
10	Yapes	10091160
10	Yerba Buena	10014050
14	1° de Agosto	14021310
14	Achiras	14098010
14	Adelia María	14098020
14	Agua de Oro	14021010
14	Agua de las Piedras	14168005
14	Alcira	14098030
14	Alcira Gigena	14098030
14	Aldea Santa María	14182010
14	Alejandro Roca	14056010
14	Alejo Ledesma	14063010
14	Alicia	14140010
14	Allmirante Brown	14021310
14	Almafuerte	14161010
14	Alpa Corral	14098040
14	Alta Gracia	14147010
14	Altautina	14126005
14	Alto Alegre	14182020
14	Alto Resbaloso - El Barrial	14133190
14	Alto de los Quebrachos	14028010
14	Altos de Chipión	14140020
14	Amboy	14007010
14	Ambul	14126010
14	Ana Zumarán	14182030
14	Anisacate	14147020
14	Arias	14063020
14	Arroyito	14140030
14	Arroyo Algodon	14042010
14	Arroyo Algodón	14042010
14	Arroyo Cabral	14042020
14	Arroyo Los Patos	14126020
14	Arroyo San Antonio	14007020
14	Arroyo de Los Patos	14126020
14	Ascochinga	14021020
14	Assunta	14056020
14	Atahona	14105010
14	Ausonia	14042030
14	Avellaneda	14049010
14	Bajo de Corrales	14126025
14	Ballesteros	14182040
14	Ballesteros Sud	14182050
14	Balnearia	14140040
14	Barrio Gilbert	14147030
14	Barrio Gilbert (1º de Mayo)	14147030
14	Barrio Gilbert (1º de Mayo) - Tejas Tres	14147030
14	Barrio Villa del Parque	14147310
14	Bañado de Soto	14028020
14	Bell Ville	14182060
14	Bengolea	14056030
14	Benjamín Gould	14182070
14	Benjamí­n Gould	14182070
14	Berrotarán	14098050
14	Bialet Massé	14091020
14	Boca del Río	14133005
14	Bouwer	14147050
14	Brinkmann	14140050
14	Buchardo	14035030
14	Bulnes	14098060
14	Cabalango	14091030
14	Calchín	14119010
14	Calchín Oeste	14119020
14	Camilo Aldao	14063030
14	Caminiaga	14154010
14	Canals	14182080
14	Candelaria Sur	14168010
14	Capilla de Romero	14133007
14	Capilla de Sitón	14168030
14	Capilla de los Remedios	14105030
14	Capilla del Carmen	14119030
14	Capilla del Monte	14091040
14	Capitán General Bernardo O Higgins	14063040
14	Capitán General Bernardo O'Higgins	14063040
14	Carnerillo	14056040
14	Carrilobo	14119040
14	Casa Grande	14091050
14	Caseros Centro	14147060
14	Caseros Este	14147063
14	Cavanagh	14063050
14	Cañada De Machado	14105020
14	Cañada Del Sauce	14007030
14	Cañada de Luque	14168020
14	Cañada de Machado	14105020
14	Cañada de Rio Pinto	14049020
14	Cañada de Río Pinto	14049020
14	Cañada de Salas	14077005
14	Cañada del Sauce	14007030
14	Cerro Colorado	14112010
14	Cerro Negro	14049025
14	Chaján	14098070
14	Chalacea	14105040
14	Chancani	14077010
14	Characato	14028035
14	Charbonier	14091060
14	Charras	14056050
14	Chazón	14042040
14	Chañar Viejo	14112020
14	Chilibroste	14182090
14	Chucul	14098080
14	Churqui Cañada	14175020
14	Chuña	14049030
14	Chuña Huasi	14154030
14	Cienaga de Allende	14126026
14	Cintra	14182100
14	Ciudad de los Niños	14021310
14	Ciénaga Del Coro	14070010
14	Ciénaga del Coro	14070010
14	Colazo	14119050
14	Colonia 10 de Julio	14140070
14	Colonia Almada	14161020
14	Colonia Anita	14140060
14	Colonia Barge	14063060
14	Colonia Bismarck	14182110
14	Colonia Bremen	14182120
14	Colonia Caroya	14021050
14	Colonia Hogar	14168035
14	Colonia Italiana	14063070
14	Colonia Iturraspe	14140215
14	Colonia Las Cuatro Esquinas	14105050
14	Colonia Las Pichanas	14140080
14	Colonia Marina	14140090
14	Colonia Prosperidad	14140100
14	Colonia San Bartolomé	14140110
14	Colonia San Pedro	14140120
14	Colonia Santa María	14140130
14	Colonia Santa Marí­a	14140130
14	Colonia Santa Rita	14042045
14	Colonia Tirolesa	14021060
14	Colonia Valtelina	14140140
14	Colonia Veinticinco	14063080
14	Colonia Vicente Agüero	14021070
14	Colonia Videla	14119060
14	Colonia Vignaud	14140150
14	Comechingones	14105230
14	Conlara	14133010
14	Copacabana	14049040
14	Coronel Baigorria	14098090
14	Coronel Moldes	14098100
14	Corral de Bustos	14063090
14	Corral de Bustos Ifflinger	14063090
14	Corralito	14133015
14	Corralito	14161030
14	Cosquín	14091070
14	Costa Sacate	14119070
14	Costasacate	14119070
14	Cruz Alta	14063100
14	Cruz de Cana	14028040
14	Cruz de Caña	14028040
14	Cruz del Eje	14028050
14	Cuatro Vientos	14098105
14	Cuesta Blanca	14091080
14	Córdoba	14014010
14	Dalmacio Vélez	14161040
14	De la Serna	14035015
14	Del Campillo	14035010
14	Despeñadero	14147080
14	Despeñaderos	14147080
14	Devoto	14140160
14	Deán Funes	14049050
14	Diego de Rojas	14105060
14	Dique Chico	14147090
14	Dumesnil	14021150
14	El Alcalde	14105070
14	El Arañado	14140170
14	El Banado	14126027
14	El Brete	14028060
14	El Chacho	14070020
14	El Corcovado - El Torreón	14007050
14	El Crispín	14105080
14	El Diquecito	14021150
14	El Durazno	14007055
14	El Fortín	14140180
14	El Fuertecito	14140190
14	El Manzano	14021110
14	El Pueblito	14021250
14	El Pueblito	14133190
14	El Rastreador	14056060
14	El Rodeo	14175030
14	El Tuscal	14175040
14	El Tío	14140200
14	El Tí­o	14140200
14	El Valle	14133190
14	Elena	14098110
14	Embalse	14007060
14	Embalse Ingeniero Reolin	14007065
14	Esquina	14105090
14	Estación Lecueder	14035020
14	Estación Luxardo	14140210
14	Estancia Vieja	14091090
14	Estancia de Guadalupe	14070030
14	Etruria	14042050
14	Eufrasio Loza	14112030
14	Falda del Carmen	14147110
14	Falda del Carmen Norte	14147113
14	Falda del Cañete	14147100
14	Finca del Sol - San Francisco - Catalina Norte	14021105
14	Freyre	14140220
14	General Baldissera	14063110
14	General Cabrera	14056070
14	General Deheza	14056080
14	General Fotheringham	14161050
14	General Levalle	14084010
14	General Paunero	14098115
14	General Paz	14021130
14	General Roca	14063120
14	Guanaco Muerto	14028080
14	Guasapampa	14070040
14	Guatimozín	14063130
14	Guayascate	14175045
14	Guiñazú Norte	14021310
14	Gutemberg	14112040
14	Hernando	14161060
14	Hipólito Bouchard	14035030
14	Huanchilla	14056090
14	Huanchillas	14056090
14	Huascha	14049055
14	Huerta Grande	14091100
14	Huinca Renancó	14035040
14	Idiazabal	14182130
14	Impira	14119080
14	Inriville	14063140
14	Intiyaco	14007075
14	Ischilin	14049057
14	Isla Verde	14063150
14	Italó	14035050
14	Jaime Peter	14049070
14	James Craik	14161070
14	Jardín Arenales	14014010
14	Jesús María	14021140
14	José de la Quintana	14147115
14	Jovita	14035110
14	Justiniano Posse	14182140
14	Juárez Celman	14021320
14	Kilómetro 658	14105100
14	Kilómetro 691	14105105
14	La Argentina	14070045
14	La Batea	14028100
14	La Boca del Río	14147120
14	La Calera	14021150
14	La Cantera	14049075
14	La Carlota	14056100
14	La Carolina	14098120
14	La Carolina El Potosi	14098120
14	La Cautiva	14098130
14	La Cesira	14084020
14	La Costa	14112045
14	La Cruz	14007070
14	La Cumbre	14091110
14	La Cumbrecita	14007080
14	La Curva	14140225
14	La Donosa	14147320
14	La Estancia	14007085
14	La Falda	14091120
14	La Floresta	14014010
14	La Francia	14140230
14	La Gilda	14098140
14	La Granja	14021160
14	La Higuera	14028110
14	La Laguna	14042060
14	La Lagunilla	14147145
14	La Paisanita	14147150
14	La Palestina	14042070
14	La Pampa	14168040
14	La Paquita	14140240
14	La Para	14105110
14	La Paz	14133060
14	La Playa	14070050
14	La Playosa	14042080
14	La Población	14133070
14	La Posta	14105120
14	La Puerta	14021170
14	La Puerta	14105130
14	La Quinta	14105140
14	La Rancherita y Las Cascadas	14147170
14	La Rinconada	14112050
14	La Serranita	14147180
14	La Tordilla	14140250
14	La Travesía	14133090
14	La Travesí­a	14133090
14	Laborde	14182150
14	Laboulaye	14084030
14	Laguna Larga	14119090
14	Las Acequias	14098150
14	Las Albahacas	14098160
14	Las Arrias	14175050
14	Las Bajadas	14007090
14	Las Caleras	14007100
14	Las Calles	14126050
14	Las Cañadas	14028120
14	Las Chacras	14021173
14	Las Chacras	14133190
14	Las Gramillas	14105150
14	Las Higueras	14098170
14	Las Isletillas	14161080
14	Las Jarillas	14091130
14	Las Junturas	14119100
14	Las Mojarras	14042090
14	Las Palmas	14077020
14	Las Perdices	14161090
14	Las Peñas	14098180
14	Las Peñas	14168060
14	Las Peñas Sud	14098180
14	Las Playas	14028130
14	Las Quintas	14147190
14	Las Rabonas	14126070
14	Las Saladas	14105160
14	Las Tapias	14133100
14	Las Varas	14140260
14	Las Varillas	14140270
14	Las Vertientes	14091135
14	Las Vertientes	14098190
14	Leguizamón	14084040
14	Leones	14063160
14	Los Cedros	14147190
14	Los Cerrillos	14133110
14	Los Chañaritos	14028140
14	Los Chañaritos	14119110
14	Los Cisnes	14056110
14	Los Cocos	14091140
14	Los Cóndores	14007110
14	Los Espinillos	14147193
14	Los Hornillos	14133120
14	Los Hoyos	14112060
14	Los Mistoles	14168070
14	Los Molinos	14007120
14	Los Morteritos	14126085
14	Los Pozos	14049080
14	Los Reartes	14007130
14	Los Sauces	14028145
14	Los Surgentes	14063170
14	Los Talares	14077030
14	Los Talas de Anisacate	14147195
14	Los Zorros	14161100
14	Lozada	14147200
14	Luca	14042100
14	Lucio V Mansilla	14175060
14	Lucio V. Mansilla	14175060
14	Luque	14119120
14	Lutti	14007140
14	Luyaba	14133150
14	Malagueno	14147210
14	Malagueño	14147210
14	Malena	14098200
14	Malli­n	14091150
14	Mallín	14091150
14	Malvinas Argentinas	14021190
14	Manfredi	14119130
14	Maquinista Gallini	14105170
14	Marcos Juarez	14063180
14	Marcos Juárez	14063180
14	Marull	14140280
14	Matorrales	14119140
14	Mattaldi	14035060
14	Mayu Sumaj	14091160
14	Media Naranja	14028150
14	Melo	14084050
14	Mendiolaza	14021200
14	Mi Granja	14021210
14	Mi Valle	14147350
14	Mina Clavero	14126090
14	Miramar	14140290
14	Miramar de Ansenuza	14140290
14	Monte Buey	14063190
14	Monte Leña	14182160
14	Monte Maíz	14182170
14	Monte Ralo	14147220
14	Monte de los Gauchos	14098210
14	Monte del Rosario	14105180
14	Montecristo	14105190
14	Morrison	14182180
14	Morteros	14140300
14	Mussi	14126100
14	Negro Huasi	14028155
14	Nicolás Bruzzone	14035070
14	Noetinger	14182190
14	Nono	14126110
14	Obispo Trejo	14105200
14	Olaeta	14056120
14	Oliva	14161110
14	Olivares de San Nicolás	14049090
14	Onagoity	14035080
14	Oncativo	14119150
14	Ordoñez	14182200
14	Pacheco de Melo	14056130
14	Pampa Alta	14147223
14	Pampayasta Norte	14161120
14	Pampayasta Sud	14161130
14	Panaholma	14126120
14	Parador De La Montana	14007163
14	Parque Calmayo	14007160
14	Parque Norte	14021310
14	Parque Norte - Ciudad de los Niños - Guiñazú Norte	14021310
14	Parque Norte - Guinazu Norte	14021310
14	Pascanas	14182210
14	Pasco	14042110
14	Paso Cabral	14007165
14	Paso Viejo	14028160
14	Paso del Durazno	14056140
14	Pilar	14119160
14	Pincén	14035090
14	Piquillín	14105210
14	Plaza Colazo	14119165
14	Plaza Luxardo	14140310
14	Plaza San Francisco	14140320
14	Plaza de Mercedes	14105220
14	Portena	14140330
14	Porteña	14140330
14	Potrerillo	14147235
14	Potrero de Garay	14147230
14	Pozo Nuevo	14154040
14	Pozo del Molle	14119170
14	Pueblo Comechingones	14105230
14	Pueblo Italiano	14182220
14	Puerto Muchita	14007167
14	Puesto de Castro	14112070
14	Punta de Agua	14105235
14	Punta del Agua	14161140
14	Quebracho Herrado	14140340
14	Quilino	14049100
14	Rafael García	14147240
14	Ramon J Cárcano	14182230
14	Ramón J. Cárcano	14182230
14	Ranqueles	14035100
14	Rayo Cortado	14112080
14	Reducción	14056170
14	Rincón	14119180
14	Rosales	14084070
14	Rosario del Saladillo	14175070
14	Rumi Huasi	14070055
14	Río Bamba	14084060
14	Río Ceballos	14021230
14	Río Cuarto	14098230
14	Río De Los Sauces	14007170
14	Río Primero	14105240
14	Río Segundo	14119190
14	Río Tercero	14161150
14	Río de los Sauces	14007170
14	Rí­o Segundo	14119190
14	Rí­o Tercero	14161150
14	Sacanta	14140350
14	Sagrada Familia	14105250
14	Saira	14063210
14	Saladillo	14063220
14	Saldán	14021240
14	Salsacate	14077040
14	Salsipuedes	14021250
14	Sampacho	14098240
14	San Agustin	14007180
14	San Agustín	14007180
14	San Antonio de Arredondo	14091180
14	San Antonio de Litin	14182240
14	San Antonio de Litín	14182240
14	San Bartolome	14098245
14	San Basilio	14098250
14	San Carlos Minas	14070060
14	San Clemente	14147250
14	San Esteban	14091190
14	San Francisco	14140360
14	San Francisco del Chanar	14154050
14	San Francisco del Chañar	14154050
14	San Geronimo	14077050
14	San Geronimo Sur	14077053
14	San Gerónimo	14077050
14	San Ignacio (Loteo San Javier)	14007190
14	San Ignacio (Loteo Vélez Crespo)	14007210
14	San Ignacio (loteo Velez Crespo)	14007191
14	San Javier y Yacanto	14133170
14	San Joaquin	14084080
14	San Joaquín	14084080
14	San Jose	14133180
14	San Jose de la Dormida	14175080
14	San Jose de las Salinas	14175090
14	San José	14133180
14	San José de la Dormida	14175080
14	San José de las Salinas	14175090
14	San Lorenzo	14126140
14	San Marcos	14182250
14	San Marcos Sierra	14028170
14	San Marcos Sud	14182250
14	San Marti­n	14126150
14	San Martín	14126150
14	San Pedro	14126160
14	San Pedro	14147265
14	San Pedro Norte	14175100
14	San Pedro de Gutemberg	14112090
14	San Pedro de Gütemberg	14112090
14	San Pedro de Toyos	14049110
14	San Roque	14091200
14	San Roque del Lago	14091020
14	San Severo	14182260
14	San Vicente	14126170
14	San Vicente	14175103
14	Sanabria	14042120
14	Santa Ana	14028175
14	Santa Catalina	14168080
14	Santa Catalina Holmberg	14098260
14	Santa Elena	14112100
14	Santa Eufemia	14056150
14	Santa Magdalena	14035110
14	Santa Mari­a de Punilla	14091210
14	Santa María de Punilla	14091210
14	Santa Mónica	14007210
14	Santa Rosa de Calamuchita	14007210
14	Santa Rosa de Río Primero	14105260
14	Santiago Temple	14119200
14	Sarmiento	14168090
14	Saturnino Mari­a Laspiur	14140370
14	Saturnino María Laspiur	14140370
14	Sauce Arriba	14126180
14	Sebastian Elcano	14112110
14	Sebastián Elcano	14112110
14	Seeber	14140380
14	Segunda Usina	14007220
14	Serrano	14084090
14	Serrezuela	14028180
14	Silvio Pellico	14042130
14	Simbolar	14168100
14	Sinsacate	14168110
14	Socavones	14147270
14	Solar de los Molinos	14007230
14	Suco	14098270
14	Tala Cañada	14077060
14	Tala Huasi	14091220
14	Talaini	14070070
14	Tancacha	14161160
14	Tanti	14091230
14	Tejas Tres	14147030
14	Tercera Usina	14007235
14	Ticino	14042140
14	Tinoco	14021270
14	Toledo	14147280
14	Toro Pujio	14140390
14	Tosno	14070080
14	Tosquita	14098280
14	Tosquitas	14098280
14	Tránsito	14140400
14	Tuclame	14028190
14	Tío Pujio	14042150
14	Tí­o Pujio	14042150
14	Ucacha	14056160
14	Unquillo	14021280
14	Va.Ciudad Pque.Los Reartes (1° Sección)	14007270
14	Va.Ciudad Pque.Los Reartes (3° Sección)	14007270
14	Valle Hermoso	14091240
14	Valle de Anisacate	14147300
14	Viamonte	14182270
14	Vicuña Mackenna	14098290
14	Villa Albertina	14049115
14	Villa Allende	14021290
14	Villa Alpina	14007240
14	Villa Amancay	14007250
14	Villa Ascasubi	14161170
14	Villa Berna	14007260
14	Villa Candelaria	14112120
14	Villa Carlos Paz	14091250
14	Villa Cerro Azul	14021300
14	Villa Ciudad Parque Los Reartes	14007270
14	Villa Ciudad de América	14147310
14	Villa Colimba	14049117
14	Villa Concepción del Tío	14140420
14	Villa Concepcón del Tí­o	14140420
14	Villa Corazon De María	14021075
14	Villa Corazón de María	14021075
14	Villa Cura Brochero	14126200
14	Villa Dolores	14133200
14	Villa El Chacay	14098300
14	Villa El Tala	14007300
14	Villa Elisa	14063230
14	Villa Flor Serrana	14091260
14	Villa Fontana	14105270
14	Villa General Belgrano	14007310
14	Villa Giardino	14091270
14	Villa Gutiérrez	14049120
14	Villa Huidobro	14035120
14	Villa La Bolsa	14147330
14	Villa La Ribera	14007320
14	Villa La Rivera	14007320
14	Villa La Viña	14133210
14	Villa Lago Azul	14091280
14	Villa Los Aromos	14147340
14	Villa Los Llanos	14021320
14	Villa Los Llanos - Juárez Celman	14021320
14	Villa Los Patos	14182280
14	Villa Maria Este	14112140
14	Villa María	14042170
14	Villa Nueva	14042180
14	Villa Oeste	14042190
14	Villa Parque Santa Ana	14147350
14	Villa Parque Siquimán	14091290
14	Villa Pastora	14021310
14	Villa Quillinzo	14007330
14	Villa Rafael Benegas	14126205
14	Villa Reducción	14056170
14	Villa Rossi	14084100
14	Villa Rumipal	14007340
14	Villa Río Icho Cruz	14091300
14	Villa San Esteban	14140440
14	Villa San Isidro	14147360
14	Villa San Miguel	14007120
14	Villa Santa Cruz del Lago	14091320
14	Villa Santa Rosa	14105260
14	Villa Sarmiento	14035130
14	Villa Sarmiento	14126210
14	Villa Tulumba	14175110
14	Villa Valeria	14035140
14	Villa Yacanto	14007360
14	Villa de María	14112130
14	Villa de Pocho	14077080
14	Villa de Soto	14028200
14	Villa de las Rosas	14133190
14	Villa del Dique	14007290
14	Villa del Prado	14147320
14	Villa del Rosario	14119210
14	Villa del Totoral	14168120
14	Villa del Tránsito	14140430
14	Wallala	14091325
14	Washington	14098320
14	Wenceslao Escalante	14182290
18	9 de Julio	18161030
18	9 de Julio (Est. Pueblo 9 de Julio)	18161030
18	Alvear	18056010
18	Barrio Balneario	18070005
18	Barrio Paraíso del Paso	18133005
18	Barrio Santa Lucía	18021015
18	Barrio Santa Rosa	18042005
18	Bella Vista	18007010
18	Berón de Astrada	18014010
18	Bonpland	18119010
18	Carolina	18070010
18	Carolina	18070011
18	Cazadores Correntinos	18035010
18	Cecilio Echavarría	18091007
18	Chavarría	18161010
18	Chavarrí­a	18161010
18	Colonia Carlos Pellegrini	18147010
18	Colonia Libertad	18112010
18	Colonia Liebig	18084010
18	Colonia Liebig's	18084010
18	Colonia Pando	18161020
18	Concepción	18028010
18	Concepción del Yaguareté Corá	18028010
18	Coronel Desiderio Sosa	18168005
18	Corrientes	18021020
18	Cruz de los Milagros	18091010
18	Curuzú Cuatiá	18035020
18	El Caimán	18154005
18	El Sombrero	18042010
18	Empedrado	18042020
18	Esquina	18049010
18	Estación Libertad	18112020
18	Estación Torrent	18056020
18	Felipe Yofré	18105010
18	Garaví	18168010
18	Garruchos	18168020
18	Gobernador Igr. Valentín Virasoro	18168030
18	Gobernador Juan E. Martínez	18091020
18	Gobernador Martínez	18091020
18	Gobernador Virasoro	18168030
18	Goya	18070020
18	Guaviraví	18147020
18	Ingenio Primer Correntino	18133010
18	Itatí	18077010
18	Ituzaingó	18084020
18	Itá Ibaté	18063010
18	José Rafael Gómez	18168010
18	Juan Pujol	18112030
18	La Cruz	18147030
18	Lavalle	18091030
18	Lomas de Vallejos	18063020
18	Loreto	18154010
18	Los Flotadores	18049015
18	Manuel Derqui	18042030
18	Mariano I. Loza	18105020
18	Mariano I. Loza (Est. Justino Solari)	18105020
18	Mburucuyá	18098010
18	Mercedes	18105030
18	Mocoretá	18112040
18	Monte Caseros	18112050
18	Nuestra Señora del Rosario de Caá Catí	18063030
18	Pago de los Deseos	18126005
18	Palmar Grande	18063040
18	Parada Acuña	18112060
18	Parada Labougle	18112070
18	Parada Pucheta	18119020
18	Paso de la Patria	18133020
18	Paso de los Libres	18119030
18	Pedro R. Fernández	18161040
18	Pedro R. Fernández (Est. Mantilla)	18161040
18	Perugorría	18035030
18	Pueblo Libertador	18049020
18	Puerto Valle	18084025
18	Ramada Paso	18077020
18	Riachuelo	18021040
18	Rincón Ombú Chico	18084027
18	Saladas	18126010
18	San Alonso	18168035
18	San Antonio	18084030
18	San Antonio de Itatí	18014010
18	San Carlos	18084040
18	San Cayetano	18021050
18	San Cosme	18133030
18	San Isidro	18042040
18	San Isidro	18070030
18	San Lorenzo	18126020
18	San Luis del Palmar	18140010
18	San Miguel	18154020
18	San Roque	18161050
18	Santa Ana	18133040
18	Santa Ana de los Guácaras	18021060
18	Santa Ana de los Guácaras	18133040
18	Santa Lucía	18091040
18	Santa Lucí­a	18091040
18	Santa Rosa	18028020
18	Santo Tomé	18168040
18	Sauce	18175010
18	Tabay	18028030
18	Tabay	18028031
18	Tapebicuá	18119040
18	Tatacua	18028040
18	Tatacuá	18028040
18	Tres de Abril	18007020
18	Villa Córdoba	18091050
18	Villa Olivari	18084050
18	Yahapé	18014020
18	Yapeyú	18147040
18	Yatay Ti Calle	18091060
18	Yatayti Calle	18091060
22	Avia Terai	22070010
22	Barranqueras	22140010
22	Barrio de los Pescadores	22126010
22	Basail	22140020
22	Campo Largo	22070020
22	Capitán Solari	22154010
22	Charadai	22161010
22	Charata	22028010
22	Chorotis	22043010
22	Ciervo Petiso	22084010
22	Colonia Aborigen	22168010
22	Colonia Baranda	22140030
22	Colonia Benítez	22126020
22	Colonia Elisa	22154020
22	Colonia José Mármol	22070025
22	Colonia La Matanza	22091002
22	Colonia Pegouriel	22098005
22	Colonia Popular	22077010
22	Colonias Unidas	22154030
22	Comandancia Frías	22063005
22	Concepción del Bermejo	22007010
22	Coronel Du Graty	22098010
22	Corzuela	22049010
22	Cote Lai	22161020
22	El Espinillo	22063010
22	El Naranjito	22140036
22	El Paraisal	22133033
22	El Paraisal	22140033
22	El Pastoril	22098015
22	El Sauzal	22063020
22	El Sauzalito	22063030
22	Enrique Urien	22098020
22	Estación General Obligado	22077020
22	Fontana	22140040
22	Fortín Belgrano	22063035
22	Fortín Las Chuñas	22070030
22	Fortín Lavalle	22063040
22	Fuerte Esperanza	22063050
22	Gancedo	22036010
22	General Capdevila	22036020
22	General José de San Martín	22084020
22	General Pinedo	22036030
22	General Vedia	22014010
22	Haumonia	22161030
22	Hermoso Campo	22039010
22	Horquilla	22161040
22	Ingeniero Barbet	22154040
22	Isla del Cerrito	22014020
22	Itín	22039020
22	Juan José Castelli	22063060
22	Kilómetro 855	22091004
22	Kilómetro 884	22091005
22	La Clotilde	22112010
22	La Curva	22091007
22	La Eduvigis	22084030
22	La Escondida	22056010
22	La Leonesa	22014030
22	La Sabana	22161050
22	La Tigra	22112020
22	La Verde	22056020
22	Laguna Blanca	22077030
22	Laguna Limpia	22084040
22	Lapachito	22056030
22	Las Breñas	22105010
22	Las Garcitas	22154050
22	Las Hacheras	22063065
22	Las Palmas	22014040
22	Las Piedritas	22105015
22	Los Frentones	22007020
22	Lote 1	22126025
22	Machagai	22168020
22	Makallé	22056040
22	Margarita Belén	22126030
22	Mesón de Fierro	22036040
22	Miraflores	22063070
22	Napalpí	22168030
22	Napenay	22070040
22	Nueva Pompeya	22063080
22	Pampa Almirón	22084050
22	Pampa Landriel	22036050
22	Pampa del Indio	22084060
22	Pampa del Infierno	22007030
22	Presidencia Roca	22084070
22	Presidencia Roque Sáenz Peña	22021010
22	Presidencia de la Plaza	22119010
22	Puerto Bermejo Nuevo	22014050
22	Puerto Bermejo Viejo	22014060
22	Puerto Eva Perón	22014070
22	Puerto Lavalle	22063090
22	Puerto Tirol	22077040
22	Puerto Vilelas	22140050
22	Quitilipi	22133010
22	Resistencia	22140060
22	Río Muerto	22007040
22	Samuhú	22147010
22	San Bernardo	22112030
22	Santa Sylvina	22043020
22	Selvas del Río de Oro	22084080
22	Taco Pozo	22007050
22	Tartagal	22063095
22	Tres Isletas	22091010
22	Tres Pozos	22063097
22	Venados Grandes	22043030
22	Villa Angela	22098030
22	Villa Berthet	22147020
22	Villa El Palmar	22133020
22	Villa Río Bermejito	22063100
22	Wichi	22063110
22	Zaparinqui	22063120
26	28 de Julio	26042040
26	Acceso Norte	26021030
26	Aldea Apeleg	26084010
26	Aldea Beleiro	26084020
26	Aldea Epulef	26056010
26	Aldea Escolar (Los Rápidos)	26035010
26	Alto Río Senguer	26084030
26	Arroyo El Pedregoso	26014005
26	Arroyo Verde	26007010
26	Astra	26021010
26	Bahía Bustamante	26021020
26	Barrio 25 de Mayo	26021030
26	Barrio Aldea Casa Blanca	26077003
26	Barrio Caleta Córdova	26021030
26	Barrio Castelli	26021030
26	Barrio Ciudadela	26021030
26	Barrio Gasoducto	26021030
26	Barrio Güemes	26021030
26	Barrio Laprida	26021030
26	Barrio Manantial Rosales	26021030
26	Barrio Militar y Aeropuerto	26021030
26	Barrio Próspero Palazzo	26021030
26	Barrio Restinga Alí	26021030
26	Barrio Rodas Park	26077005
26	Barrio Rodríguez Peña	26021030
26	Barrio Saavedra	26021030
26	Barrio Sarmiento	26021030
26	Barrio Villa S.U.P.E.	26021030
26	Blancuntre	26049010
26	Buen Pasto	26091010
26	Buenos Aires Chico	26014010
26	Caleta Olivares	26021030
26	Camarones	26028010
26	Carrenleufú	26056020
26	Cerro Centinela	26035015
26	Cerro Cóndor	26070010
26	Cholila	26014020
26	Colan Conhué	26056030
26	Comodoro Rivadavia	26021030
26	Corcovado	26035020
26	Costa del Chubut	26014025
26	Cushamen Centro	26014030
26	Diadema Argentina	26021040
26	Dique Florentino Ameghino	26042010
26	Doctor Oscar Atilio Viglione (Frontera de Río Pico)	26098010
26	Doctor Ricardo Rojas	26084040
26	Dolavon	26042020
26	Don Emilio	26077007
26	El Blanco	26014037
26	El Escorial	26049020
26	El Hoyo	26014040
26	El Maitén	26014050
26	El Mirasol	26063010
26	Epuyén	26014060
26	Esquel	26035030
26	Facundo	26084050
26	Fofo Cahuel	26014065
26	Gaiman	26042030
26	Gan Gan	26105010
26	Garayalde	26028020
26	Gastre	26049030
26	Gobernador Costa	26098020
26	Gualjaina	26014070
26	José de San Martín	26098030
26	Kilómetro 11 - Cuarteles	26021030
26	Kilómetro 3 - General Mosconi	26021030
26	Kilómetro 5 - Presidente Ortíz	26021030
26	Kilómetro 8 - Don Bosco	26021030
26	La Herradura	26021045
26	Lago Blanco	26084060
26	Lago Epuyén	26014080
26	Lago Puelo	26014090
26	Lago Rosario	26035040
26	Lagunita Salada	26049040
26	Las Plumas	26063020
26	Leleque	26014100
26	Los Altares	26070020
26	Los Cipreses	26035050
26	Paso de Indios	26070030
26	Paso del Sapo	26056040
26	Playa Magagna	26077010
26	Playa Unión	26077020
26	Puerto Madryn	26007020
26	Puerto Pirámides	26007030
26	Quintas El Mirador	26007040
26	Rada Tilly	26021050
26	Rawson	26077030
26	Reserva Area Protegida El Doradillo	26007050
26	Río Mayo	26084070
26	Río Pico	26098040
26	Sarmiento	26091020
26	Tecka	26056050
26	Telsen	26105020
26	Trelew	26077040
26	Trevelín	26035060
26	Villa Futalaufquen	26035070
26	Villa Lago Rivadavia	26014110
26	Yala Laubat	26049050
30	1º de Mayo	30098090
30	Alcaraz	30070005
30	Aldea Asunción	30049010
30	Aldea Brasilera	30021010
30	Aldea Grapschental	30021015
30	Aldea María Luisa	30084010
30	Aldea Protestante	30021020
30	Aldea Salto	30021030
30	Aldea San Antonio	30056010
30	Aldea San Antonio	30084013
30	Aldea San Francisco	30021040
30	Aldea San Gregorio	30008005
30	Aldea San Isidro (El Cimarrón)	30035020
30	Aldea San Juan	30056020
30	Aldea San Juan	30084015
30	Aldea San Rafael	30084020
30	Aldea Santa María	30084030
30	Aldea Santa Rosa	30084040
30	Aldea Spatzenkutter	30021050
30	Aldea Valle María	30021060
30	Altamirano Sur	30091010
30	Antelo	30105010
30	Aranguren	30077010
30	Arroyo Barú	30008010
30	Arroyo Clé	30091030
30	Barrio Coelho	30015005
30	Barrio Parque El Morajú	30077015
30	Barrio San José	30021065
30	Barrio Yuquerí Chico	30015007
30	Basavilbaso	30098010
30	Benito Legerén	30015060
30	Betbeder	30077020
30	Bovril	30070010
30	Brazo Largo	30063015
30	Calabacilla	30015010
30	Camino al Ñandubaysal	30056025
30	Caseros	30098020
30	Ceibas	30063020
30	Cerrito	30084050
30	Chajarí	30028010
30	Clodomiro Ledesma	30015020
30	Colonia Alemana	30028020
30	Colonia Avellaneda	30084060
30	Colonia Avigdor	30070020
30	Colonia Ayuí	30015030
30	Colonia Crespo	30084065
30	Colonia Elía	30098030
30	Colonia Ensayo	30021070
30	Colonia General Roca	30015040
30	Colonia Hugues	30008030
30	Colonia La Argentina	30028040
30	Colonia Nueva	30084067
30	Colón	30008020
30	Concepción del Uruguay	30098040
30	Concordia	30015060
30	Conscripto Bernardi	30035010
30	Crespo	30084070
30	Cuchilla Redonda	30056027
30	Diamante	30021080
30	Don Cristóbal	30077030
30	Don Cristóbal II	30077030
30	Durazno	30091020
30	El Brillante	30008090
30	El Cimarrón	30035020
30	El Colorado	30008090
30	El Palenque	30084080
30	El Pingo	30084090
30	El Quebracho	30070025
30	El Ramblón	30084095
30	El Solar	30070030
30	Enrique Carbó	30056030
30	Entre Comunas	30105015
30	Estacion Yuquerí	30015083
30	Estación Arroyo Clé	30091030
30	Estación Camps	30021090
30	Estación Escriña	30056035
30	Estación Lazo	30049020
30	Estación Parera	30056040
30	Estación Puiggari	30021150
30	Estación Raíces	30113010
30	Estación Sosa	30084240
30	Estación Yeruá	30015080
30	Estación Yuquerí	30015083
30	Estancia Grande	30015087
30	Faustino M. Parera	30056040
30	Febré	30077040
30	Federación	30028070
30	Federal	30035030
30	General Almada	30056050
30	General Alvear	30021100
30	General Campos	30088010
30	General Galarza	30049030
30	General Racedo (El Carmen)	30021110
30	General Ramírez	30021120
30	Gilbert	30056060
30	Gobernador Echagüe	30091040
30	Gobernador Etchevehere	30084290
30	Gobernador Mansilla	30091050
30	Gobernador Racedo	30021110
30	Gobernador Sola	30091060
30	Gobernador Solá	30091060
30	Gualeguay	30049040
30	Gualeguaychú	30056070
30	Gualeguaycito	30028073
30	Guardamonte	30091070
30	Hambis	30008040
30	Hasenkamp	30084100
30	Hernandarias	30084110
30	Hernández	30077050
30	Herrera	30098060
30	Hocker	30008050
30	Ibicuy	30063030
30	Ingeniero Miguel Sajaroff	30113020
30	Ingeniero Sajaroff	30113020
30	Irazusta	30056080
30	Jubileo	30113030
30	La Clarita	30008060
30	La Criolla	30015090
30	La Floresta	30028075
30	La Juanita	30021123
30	La Muela	30028077
30	La Paz	30070040
30	La Picada	30084120
30	La Providencia	30070041
30	La Verbena	30042005
30	Lago Salto Grande	30015095
30	Larroque	30056090
30	Las Colinas	30084125
30	Las Cuevas	30021125
30	Las Delicias	30035035
30	Las Garzas	30084170
30	Las Guachas	30091080
30	Las Jaulas	30021127
30	Las Masitas	30021128
30	Las Moscas	30098070
30	Las Tejas	30015060
30	Las Tunas	30084130
30	Los Cerros	30105035
30	Los Charrúas	30015100
30	Los Conquistadores	30028080
30	Lucas González	30077060
30	Líbaros	30098080
30	Maciá	30091090
30	María Grande	30084140
30	Mazaruca	30063035
30	Molino Doll	30105040
30	Médanos	30063040
30	Nogoyá	30077070
30	Nueva Escocia	30015110
30	Nueva Vizcaya	30035040
30	Ombú	30070043
30	Oro Verde	30084150
30	Osvaldo Magnasco	30015120
30	Paraje La Tacuara	30105043
30	Paraje La Virgen	30021130
30	Paraje Las Tunas	30084130
30	Paraná	30084160
30	Parque Balneario Delio Panizza	30091095
30	Paso Telégrafo	30070047
30	Paso de la Laguna	30113050
30	Pastor Britos	30056095
30	Pedernal	30015130
30	Picada Berón	30070048
30	Piedras Blancas	30070050
30	Pronunciamiento	30098100
30	Pueblo Bellocq (Las Garzas)	30084170
30	Pueblo Brugo	30084180
30	Pueblo Cazes	30008070
30	Pueblo General Belgrano	30056100
30	Pueblo General Paz	30084185
30	Pueblo General San Martín	30084190
30	Pueblo Liebig	30008080
30	Pueblo Liebig's	30008080
30	Pueblo Moreno	30084050
30	Puerto Algarrobo	30070065
30	Puerto Curtiembre	30084190
30	Puerto Esquina	30105045
30	Puerto Las Cuevas	30021140
30	Puerto Ruiz	30049050
30	Puerto Yeruá	30015140
30	Punta Bonita	30015150
30	Punta del Monte	30049060
30	Rincón de Nogoyá	30105050
30	Rincón de Nogoyá Sur	30105052
30	Rincón del Doll	30105055
30	Rocamora	30098110
30	Rosario del Tala	30091100
30	San Benito	30084200
30	San Cipriano	30098115
30	San Gustavo	30070070
30	San Jaime de la Frontera	30028090
30	San José	30008090
30	San José de Feliciano	30042010
30	San Justo	30098140
30	San Marcial	30098150
30	San Pedro	30028100
30	San Ramírez	30070075
30	San Ramón	30028105
30	San Salvador	30088020
30	San Víctor	30042020
30	Santa Ana	30028110
30	Santa Anita	30098120
30	Santa Elena	30070080
30	Santa María y Las Margaritas	30028115
30	Sauce Montrull	30084210
30	Sauce Pinto	30084220
30	Sauce de Luna	30035050
30	Seguí	30084230
30	Sir Leonard	30070090
30	Sosa	30084240
30	Strobel	30021080
30	Tabossi	30084250
30	Tezanos Pinto	30084260
30	Ubajay	30008100
30	Urdinarrain	30056110
30	Viale	30084270
30	Victoria	30105060
30	Villa Adela	30015060
30	Villa Aranguren	30077010
30	Villa Clara	30113060
30	Villa Domínguez	30113070
30	Villa Elisa	30008110
30	Villa Fontana	30084280
30	Villa Gdor. Luis F. Etchevehere	30084290
30	Villa Libertador San Martín	30021150
30	Villa Mantero	30098130
30	Villa Paranacito	30063060
30	Villa Sabá Z. Hernández	30077050
30	Villa San Justo	30098140
30	Villa San Marcial (Est. Gobernador Urquiza)	30098150
30	Villa Urquiza	30084300
30	Villa Zorraquín	30015060
30	Villa del Rosario	30028120
30	Villaguay	30113080
30	XX de Setiembre	30077080
30	Yacaré	30070095
30	Yeso Oeste	30070100
30	Ñancay	30063050
34	Banco Payaguá	34021010
34	Bartolomé De Las Casas	34035010
34	Bartolomé de las Casas	34035010
34	Boca Riacho Pilagás	34014005
34	Buena Vista	34042010
34	Campo Del Cielo	34035012
34	Campo Grande	34028004
34	Campo Tres Pozos	34035014
34	Clorinda	34049010
34	Colonia Aborigen Bartolomé de las Casas	34035015
34	Colonia Campo Villafañe	34056010
34	Colonia Javier Muñiz	34035018
34	Colonia Pastoril	34014010
34	Colonia Sarmiento	34035020
34	Colonia Sudamerica	34049013
34	Colonia Unión Escuela	34035025
34	Comandante Fontana	34035030
34	Comunidad Aborigen Bartolomé de las Casas	34035010
34	Comunidad Aborigen Laká Wichi	34035033
34	Comunidad Aborigen Wichi Oblitaj	34063005
34	El Breal	34063007
34	El Colorado	34056020
34	El Espinillo	34042020
34	El Potrillo	34063010
34	El Quebracho	34063030
34	El Quemado	34007002
34	El Recreo	34035040
34	Estanislao Del Campo	34035050
34	Estanislao del Campo	34035050
34	Formosa	34014020
34	Fortin Soledad	34007003
34	Fortín Cabo 1º Lugones	34035060
34	Fortín Sargento 1º Leyes	34035070
34	Fortín Soledad	34007003
34	General Lucio V. Mansilla	34021020
34	General Lucio Victorio Mansilla	34021020
34	General Mosconi	34063020
34	Gran Guardia	34014030
34	Guadalcazar	34007005
34	Herradura	34021030
34	Ibarreta	34035080
34	Ingeniero Guillermo N Juárez	34028010
34	Ingeniero Guillermo N. Juárez	34028010
34	Juan G Bazán	34035090
34	Juan G. Bazán	34035090
34	La Brea	34063040
34	La Libertad	34007006
34	La Rinconada	34007007
34	Laguna Blanca	34049020
34	Laguna Gallo	34042030
34	Laguna Naick-Neck	34049030
34	Laguna Yema	34007010
34	Lamadrid	34007015
34	Las Cañitas	34063050
34	Las Lomitas	34035100
34	Loro Cué	34042035
34	Los Chiriguanos	34007020
34	Los Matacos	34056025
34	Lote 8	34063060
34	Lucero Cué	34049035
34	Mariano Boedo	34014040
34	María Cristina	34063070
34	Mayor Villafañe	34056010
34	Misión Pozo Yacaré	34028020
34	Misión San Andres	34063080
34	Misión Tacaaglé	34042040
34	Mojón De Fierro	34014050
34	Mojón de Fierro	34014050
34	Monte Lindo	34056027
34	Palma Sola	34049040
34	Palmar Largo	34063090
34	Palo Santo	34056030
34	Pirané	34056040
34	Portón Negro	34042050
34	Posta Cambio Zalazar	34035110
34	Pozo De Maza	34007030
34	Pozo Del Mortero	34007040
34	Pozo Del Tigre	34035120
34	Pozo La Chiva	34063100
34	Pozo de Maza	34007030
34	Pozo del Mortero	34007040
34	Pozo del Tigre	34035120
34	Puerto Pilcomayo	34049050
34	Riacho He-He	34049060
34	Riacho He-he	34049060
34	Riacho Negro	34049070
34	Río Muerto	34007043
34	San Francisco De Laishi	34021040
34	San Francisco de Laishi	34021040
34	San Hilario	34014060
34	San Martín I	34035130
34	San Martín II	34035140
34	Santa Isabel	34007045
34	Siete Palmas	34049080
34	Subteniente Perín	34035150
34	Sumayen	34007047
34	Tatané	34021050
34	Tres Lagunas	34042060
34	Vaca Perdida	34007050
34	Villa Escolar	34021060
34	Villa General Güemes	34035160
34	Villa General Manuel Belgrano	34035170
34	Villa Kilómetro 213	34056050
38	Abra Pampa	38007020
38	Abralaite	38007030
38	Agua de Castilla	38007035
38	Aguas Calientes	38014010
38	Aparzo	38028003
38	Arrayanal	38063010
38	Arroyo Colorado	38063020
38	Bananal	38035010
38	Barrio El Milagro	38014020
38	Barrio La Unión	38014030
38	Barrio Odij	38014030
38	Barrio Parque La Ciénaga	38014035
38	Barrios	38112010
38	Bermejito	38035020
38	Bárcena	38098010
38	Caimancito	38035030
38	Calilegua	38035040
38	Cangrejillos	38112020
38	Carahunco	38042010
38	Casa Colorada	38049003
38	Casabindo	38007040
38	Casira	38077010
38	Caspalá	38105010
38	Catua	38084010
38	Centro Forestal	38042020
38	Cerro Colorado	38112023
38	Chalguamayoc	38112025
38	Chalicán	38035050
38	Cianzo	38028007
38	Cieneguillas	38077030
38	Ciénega de Paicone	38077020
38	Cochinoca	38007050
38	Coctaca	38028010
38	Colonia San José	38094010
38	Comunidad Coquena	38098015
38	Coranzuli	38084020
38	Corral Blanco	38112026
38	Coyaguaima	38049007
38	Cusi Cusi	38077040
38	Don Emilio	38063030
38	El Acheral	38063040
38	El Aguilar	38028020
38	El Angosto	38077045
38	El Carmen	38014040
38	El Ceibal	38056010
38	El Cóndor	38112030
38	El Fuerte	38070010
38	El Moreno	38098020
38	El Piquete	38070020
38	El Puesto	38063050
38	El Quemado	38063060
38	El Talar	38070030
38	El Toro	38084030
38	Fleming	38014010
38	Fraile Pintado	38035060
38	Guerrero	38021010
38	Hipólito Yrigoyen	38028030
38	Hornadita de la Cordillera	38112033
38	Huacalera	38094020
38	Humahuaca	38028040
38	Huáncar	38084040
38	Inti Cancha	38112035
38	Jama	38084045
38	Juella	38094030
38	La Almona	38021020
38	La Ciénega	38077050
38	La Esperanza	38063070
38	La Intermedia	38112040
38	La Manga	38063080
38	La Mendieta	38063090
38	La Ovejería	38014042
38	La Quiaca	38112050
38	La Redonda	38007055
38	La Toma	38056015
38	Lagunillas de Farallón	38049010
38	Las Pampitas	38014043
38	Las Peras	38094035
38	León	38021030
38	Libertad	38035070
38	Libertador General San Martín	38035080
38	Liviara	38049020
38	Llulluchayoc	38112060
38	Lobaton	38063095
38	Loma Blanca	38049025
38	Loma Hermosa	38056016
38	Los Alisos	38056017
38	Los Lapachos	38014050
38	Los Nogales	38021070
38	Los Paños	38056018
38	Los Ávalos	38014045
38	Loteo Navea	38056020
38	Lozano	38021040
38	Maimará	38094040
38	Manantiales	38014060
38	Maíz Negro	38035090
38	Mina Providencia	38084050
38	Misarrumi	38077060
38	Miyuyoc	38028042
38	Monterrico	38014070
38	Nuestra Señora del Rosario	38056025
38	Nuevo Pirquitas	38049030
38	Ocloyas	38021050
38	Olacapato	38084055
38	Olaroz Chico	38084060
38	Oratorio	38077070
38	Orosmayo	38049035
38	Paicone	38077080
38	Palca de Aparzo	38028043
38	Palca de Varas	38028045
38	Palma Sola	38070040
38	Palos Blancos	38063110
38	Palpalá	38042040
38	Pampa Blanca	38014080
38	Pampichuela	38105020
38	Pastos Chicos	38084070
38	Paulina	38035100
38	Perico	38014090
38	Piedritas	38063130
38	Pila Pardo	38014010
38	Pueblo Ledesma	38035080
38	Puente Lavayén	38070050
38	Puerta de Colorados	38098025
38	Puesto Sey	38084080
38	Puesto Viejo	38014100
38	Puesto del Marquéz	38007060
38	Pumahuasi	38112070
38	Purmamarca	38098030
38	Quebraleña	38007063
38	Quera	38007067
38	Rinconada	38049040
38	Rinconadillas	38007070
38	Rodeito	38063140
38	Rodero	38028047
38	Rosario de Río Grande (ex Barro Negro)	38063150
38	Río Blanco	38042040
38	San Antonio	38056030
38	San Antonio	38063160
38	San Francisco	38105030
38	San Francisco de Alfarcito	38007080
38	San Isidro	38014110
38	San José	38112080
38	San Juan de Dios	38063165
38	San Juan de Oros	38077090
38	San Juan de Quillaqués	38084090
38	San Juancito	38014120
38	San Lucas	38063170
38	San Miguel de Colorados	38098035
38	San Pablo de Reyes	38021070
38	San Pedro	38063180
38	San Salvador de Jujuy	38021060
38	Santa Ana	38105040
38	Santa Ana de la Puna	38007085
38	Santa Catalina	38077100
38	Santa Clara	38070060
38	Santo Domingo	38049050
38	Santuario de Tres Pozos	38007090
38	Sauzalito	38007092
38	Suripugio	38112075
38	Susques	38084100
38	Tambillos	38007095
38	Tesorero	38021065
38	Tilcara	38094050
38	Timon Cruz	38077105
38	Tres Cruces	38028050
38	Tumbaya	38098040
38	Tusaquillas	38007100
38	Uquía	38028060
38	Valle Colorado	38105050
38	Valle Grande	38105060
38	Vinalito	38070070
38	Volcán	38098050
38	Yacoraite	38094010
38	Yala	38021070
38	Yavi	38112080
38	Yavi Chico	38112090
38	Yoscaba	38077110
38	Yuto	38035110
42	25 de Mayo	42112020
42	Abramo	42077010
42	Adolfo Van Praet	42133010
42	Agustoni	42105010
42	Algarrobo del Águila	42063010
42	Alpachiri	42070010
42	Alta Italia	42133020
42	Anguil	42021010
42	Anzoátegui	42014010
42	Arata	42147010
42	Ataliva Roca	42154010
42	Bernardo Larroude	42056010
42	Bernasconi	42077020
42	Cachirulo	42140005
42	Caleufú	42126010
42	Carro Quemado	42098010
42	Casa de Piedra	42112005
42	Catriló	42028010
42	Ceballos	42056020
42	Chacharramendi	42154020
42	Colonia Barón	42119010
42	Colonia San José	42119020
42	Colonia Santa María	42154030
42	Conhelo	42035010
42	Coronel Hilario Lagos	42056030
42	Cuchillo Co	42084010
42	Damián Maisonave	42133030
42	Doblas	42007010
42	Dorila	42105020
42	Eduardo Castex	42035020
42	Embajador Martini	42133040
42	Falucho	42133050
42	General Acha	42154040
42	General Manuel J. Campos	42070020
42	General Pico	42105030
42	General San Martín	42077030
42	Gobernador Duval	42042010
42	Guatraché	42070030
42	Hucal	42077040
42	Ingeniero Foster	42126020
42	Ingeniero Luiggi	42133060
42	Intendente Alvear	42056040
42	Jacinto Aráuz	42077050
42	La Adela	42014020
42	La Cuesta del Sur	42140007
42	La Gloria	42028020
42	La Humada	42063020
42	La Maruja	42126030
42	La Reforma	42091010
42	Limay Mahuida	42091020
42	Lonquimay	42028030
42	Loventué	42098020
42	Luan Toro	42098030
42	Macachín	42007020
42	Mauricio Mayer	42035030
42	Metileo	42147020
42	Miguel Cané	42119030
42	Miguel Riglos	42007030
42	Monte Nievas	42035040
42	Naicó	42140010
42	Ojeda	42133070
42	Parera	42126040
42	Perú	42070040
42	Pichi Huinca	42126050
42	Puelches	42042020
42	Puelén	42112010
42	Quehué	42154050
42	Quemú Quemú	42119040
42	Quetrequén	42126060
42	Rancul	42126070
42	Realicó	42133080
42	Relmo	42119050
42	Rolón	42007040
42	Rucanelo	42035050
42	Santa Isabel	42049010
42	Santa Rosa	42021020
42	Santa Teresa	42070050
42	Sarah	42056050
42	Speluzzi	42105040
42	Telén	42098040
42	Toay	42140020
42	Tomás M. Anchorena	42007050
42	Trebolares	42105050
42	Trenel	42147030
42	Unanué	42154060
42	Uriburu	42028040
42	Victorica	42098050
42	Villa Mirasol	42119060
42	Vértiz	42056060
42	Winifreda	42035060
46	Aicuñá	46028010
46	Aimogasta	46007010
46	Alpasinche	46119010
46	Alto Carrizal	46049010
46	Amaná	46105010
46	Ambil	46084010
46	Aminga	46021010
46	Amuschina	46119010
46	Andolucas	46119010
46	Anguinán	46042010
46	Angulos	46049020
46	Anillaco	46021020
46	Anjullón	46021030
46	Antinaco	46049030
46	Bajo Carrizal	46049040
46	Banda Florida	46028050
46	Bañado de los Pantanos	46007030
46	Campanas	46049050
46	Castro Barros	46063010
46	Chamical	46035010
46	Chaupihuasi	46119010
46	Chañar	46063020
46	Chañarmuyo	46049060
46	Chepes	46112010
46	Chilecito	46042010
46	Chuquis	46021040
46	Colonia Anguinán	46042020
46	Colonia Malligasta	46042040
46	Colonia Ortiz de Ocampo	46084020
46	Colonia Vichigasta	46042050
46	Cuipán	46119010
46	Desiderio Tello	46112020
46	Estación Mazán	46007040
46	Famatina	46049070
46	Guanchín	46042060
46	Guandacol	46028020
46	Jagüé	46098010
46	La Cuadra	46049080
46	La Puntilla	46042010
46	La Rioja	46014010
46	Las Talas	46119010
46	Loma Blanca	46063030
46	Los Molinos	46021050
46	Los Palacios	46028030
46	Los Robles	46119010
46	Los Sarmientos	46042010
46	Machigasta	46007010
46	Malanzán	46070010
46	Malligasta	46042070
46	Milagro	46084030
46	Miranda	46042080
46	Nonogasta	46042090
46	Nácate	46070020
46	Olpas	46084040
46	Olta	46063040
46	Pagancillo	46028040
46	Patquía	46105020
46	Pinchas	46021060
46	Pituil	46049090
46	Plaza Vieja	46049100
46	Polco	46035020
46	Portezuelo	46070030
46	Punta de los Llanos	46056010
46	Salicas	46119010
46	Salicas - San Blas	46119010
46	San Antonio	46007010
46	San Antonio	46070040
46	San Blas	46119010
46	San Miguel	46042010
46	San Nicolás	46042100
46	San Pedro	46021070
46	Santa Clara	46028020
46	Santa Cruz	46049110
46	Santa Florentina	46042110
46	Santa Rita de Catuna	46084050
46	Santa Vera Cruz	46021080
46	Santo Domingo	46049120
46	Sañogasta	46042120
46	Shaqui	46119010
46	Suriyaco	46119010
46	Tama	46056020
46	Termas de Santa Teresita	46007045
46	Tilimuqui	46042130
46	Tuyubil	46119010
46	Ulapes	46091010
46	Vichigasta	46042140
46	Villa Castelli	46077010
46	Villa Mazán	46007050
46	Villa San José de Vinchina	46098020
46	Villa Sanagasta	46126010
46	Villa Unión	46028050
50	10ma Sección	50007010
50	11va Sección	50007010
50	1ra Sección	50007010
50	25 de Mayo	50105220
50	2da Sección	50007010
50	3 de Mayo	50056150
50	3ra Sección	50007010
50	4ta Sección	50007010
50	5ta Sección	50007010
50	6ta Sección	50007010
50	7ma Sección	50007010
50	8va Sección	50007010
50	9na Sección	50007010
50	Agrelo	50063010
50	Agua Escondida	50077010
50	Alto Salvador	50098010
50	Alto Salvador Sur	50098012
50	Alto Verde	50098005
50	Alto Verde	50098020
50	Alto Verde	50098045
50	Andrade	50084010
50	Bardas Blancas	50077020
50	Barrancas	50070010
50	Barrio 12 de Octubre	50112010
50	Barrio 9 de Julio	50070025
50	Barrio Alto del Olvido	50056010
50	Barrio Belgrano Norte	50126010
50	Barrio Carrasco	50091005
50	Barrio Chivilcoy	50098030
50	Barrio Cooperativa Eléctrica	50084017
50	Barrio Cooperativa Los Campamentos	50084020
50	Barrio Cooperativa Reducción	50084023
50	Barrio El Carmen	50056015
50	Barrio El Cepillo	50091010
50	Barrio El Nevado	50105020
50	Barrio Emanuel	50098040
50	Barrio Empleados de Comercio	50105030
50	Barrio Intendencia	50105040
50	Barrio Jesús de Nazaret	50070020
50	Barrio Jocolí II	50056020
50	Barrio José Hernández	50126015
50	Barrio La Estación	50098045
50	Barrio La Palmera	50056030
50	Barrio La Pega	50056040
50	Barrio Lagunas de Bartoluzzi	50056050
50	Barrio Los Charabones	50098050
50	Barrio Los Jarilleros	50056060
50	Barrio Los Olivos	50056070
50	Barrio María Auxiliadora	50112020
50	Barrio Molina Cabrera	50112030
50	Barrio Ntra. Sra. De Fátima	50098055
50	Barrio Nuestra Señora de Fátima	50098055
50	Barrio Perdriel IV	50063020
50	Barrio Rivadavia	50084030
50	Barrio San Cayetano	50119010
50	Barrio Santa Marí­a	50056072
50	Barrio Santa Rita	50056073
50	Barrio Virgen del Rosario	50056075
50	Bermejo	50028020
50	Blanco Encalada	50049010
50	Bo Nueva California Sur	50098111
50	Bowen	50014010
50	Buena Nueva	50028020
50	Cacheuta	50049015
50	Cacheuta	50063030
50	Campo Los Andes	50119020
50	Canalejas	50014015
50	Capdevila	50049050
50	Capilla San Expedito	50098057
50	Capilla del Rosario	50028020
50	Capitán Montoya	50105050
50	Carmensa	50014020
50	Carrodilla	50063090
50	Chacras de Coria	50063090
50	Chapanay	50098060
50	Chilecito	50091020
50	Chivilcoy	50098070
50	Ciudad Luján de Cuyo	50063090
50	Ciudad de Godoy Cruz	50021010
50	Ciudad de Las Heras	50049050
50	Ciudad de Maipú	50070060
50	Colonia Italia	50056078
50	Colonia Las Rosas	50119030
50	Colonia Segovia	50028010
50	Coquimbito	50070060
50	Cordón del Plata	50126020
50	Costa Flores	50063040
50	Costa de Araujo	50056080
50	Cruz de Piedra	50070030
50	Cuadro Benegas	50105060
50	Cuadro Nacional	50105210
50	Cuadro Ortega	50084070
50	Desaguadero	50042010
50	Dorrego	50028020
50	El Algarrobal	50049050
50	El Algarrobo	50119035
50	El Borbollón	50049050
50	El Carrizal	50063050
50	El Ceibo	50014025
50	El Challao	50049050
50	El Chical	50056085
50	El Espino	50098073
50	El Manzano	50077025
50	El Manzano	50119040
50	El Mirador	50084040
50	El Nihuil	50105070
50	El Paramillo	50056090
50	El Pedregal	50070040
50	El Peral	50126030
50	El Plumerillo	50049050
50	El Ramblón	50098077
50	El Ramblón	50112077
50	El Resguardo	50049050
50	El Salto	50063060
50	El Sauce	50028020
50	El Sosneado	50105080
50	El Toledano Norte	50105215
50	El Tropezón	50105090
50	El Vergel	50056100
50	El Zampal	50126035
50	El Zapallar	50049050
50	Eugenio Bustos	50091030
50	Fray Luis Beltrán	50070050
50	General Alvear	50014030
50	General Belgrano	50028020
50	General Gutiérrez	50070060
50	Gobernador Benegas	50021010
50	Godoy Cruz	50021010
50	Goudge	50105100
50	Guaymallén	50028020
50	Ingeniero Giagnoni	50035010
50	Ingeniero Gustavo André	50056110
50	Jaime Prats	50105110
50	Jesús Nazareno	50028020
50	Jocolí	50049030
50	Jocolí	50056120
50	Jocolí Viejo	50056130
50	Junín	50035020
50	La Arboleda	50126040
50	La Arboleda Sur	50126043
50	La Asunción	50056135
50	La Central	50084050
50	La Cieneguita	50049050
50	La Colonia	50035030
50	La Consulta	50091040
50	La Dormida	50112040
50	La Esperanza	50084060
50	La Florida	50084070
50	La Junta	50077028
50	La Libertad	50084080
50	La Llave Nueva	50105120
50	La Paz	50042020
50	La Primavera	50028030
50	La Puntilla	50063090
50	La Riojita	50119045
50	Las Catitas	50112050
50	Las Cañas	50028020
50	Las Chimbas	50098079
50	Las Compuertas	50063070
50	Las Cuevas	50049040
50	Las Cuevas	50063075
50	Las Heras	50049050
50	Las Leñas	50077030
50	Las Malvinas	50105130
50	Las Tortugas	50021010
50	Las Vegas	50063080
50	Las Violetas	50056140
50	Los Barriales	50035040
50	Los Campamentos	50084100
50	Los Compartos	50014040
50	Los Corralitos	50028040
50	Los Penitentes	50049060
50	Los Reyunos	50105140
50	Los Sauces	50119050
50	Los Árboles	50084090
50	Loteo Moyano	50126045
50	Luján de Cuyo	50063090
50	Luzuriaga	50070060
50	Maipú	50070060
50	Malargüe	50077040
50	Mayor Drummond	50063090
50	Medrano	50035050
50	Medrano	50084110
50	Mendoza	50007010
50	Monte Comán	50105150
50	Montecaseros	50098080
50	Mundo Nuevo	50035120
50	Mundo Nuevo	50084120
50	Nueva California	50098090
50	Nueva Ciudad	50028020
50	Palmira	50098100
50	Panquehuá	50049050
50	Pareditas	50091050
50	Pedro Molina	50028020
50	Perdriel	50063100
50	Phillips	50035060
50	Pobre Diablo	50105160
50	Polvaredas	50049080
50	Potrerillos	50063110
50	Presidente Sarmiento	50021010
50	Puente de Hierro	50028050
50	Puente del Inca	50049090
50	Punta de Vacas	50049100
50	Punta del Agua	50105170
50	Rama Caida	50105180
50	Rama Caída	50105180
50	Ranquil Norte	50077050
50	Real del Padre	50105190
50	Reducción de Abajo	50084130
50	Rivadavia	50084140
50	Rodeo de la Cruz	50028020
50	Rodeo del Medio	50070070
50	Rodríguez Peña	50035070
50	Salto de las Rosas	50105200
50	San Carlos	50091060
50	San Francisco del Monte	50021010
50	San Francisco del Monte	50028020
50	San José	50028020
50	San José	50126050
50	San Martín	50098100
50	San Martín - La Colonia	50098100
50	San Rafael	50105210
50	San Roque	50070090
50	Santa María de Oro	50084150
50	Santa Rosa	50112060
50	Sierras de Encalada	50049050
50	Tres Esquinas	50091070
50	Tres Porteñas	50098110
50	Tunuyán	50119060
50	Tupungato	50126060
50	Ugarteche	50063120
50	Uspallata	50049110
50	Villa Antigua	50042030
50	Villa Arroyo Grande	50119065
50	Villa Atuel	50105230
50	Villa Atuel Norte	50105240
50	Villa Bastias	50126060
50	Villa Clarita	50049120
50	Villa El Chacón	50091080
50	Villa Nueva	50028020
50	Villa Seca	50119067
50	Villa Teresa	50070100
50	Villa Tulumaya	50056160
50	Vista Flores	50119070
50	Vistalba	50063090
54	1º de Mayo	54014060
54	25 de Mayo	54119060
54	9 de Julio Kilómetro 20	54042050
54	9 de Julio Kilómetro 28	54042040
54	Alba Posse	54119010
54	Aldea Perutí	54077005
54	Alicia Alta	54119020
54	Alicia Baja	54119025
54	Almafuerte	54070010
54	Apóstoles	54007010
54	Aristóbulo del Valle	54014010
54	Arroyo del Medio	54070020
54	Azara	54007020
54	Bario Ita	54084007
54	Barra Concepción	54035010
54	Barrio 20 de Junio	54098006
54	Barrio Cuatro Bocas	54084003
54	Barrio El Francés	54098003
54	Barrio Escuela 461	54091013
54	Barrio Escuela 461	54091014
54	Barrio Escuela 633	54091017
54	Barrio Guatambu	54084005
54	Barrio Rural	54007025
54	Barrio San Isidro	54056005
54	Barrio Santa Teresita	54084008
54	Barrio Tungoil	54098005
54	Barrio del Lago	54021005
54	Bernardo de Irigoyen	54049020
54	Bonpland	54021010
54	Bº Bernardino Rivadavia	54014050
54	Caburei	54049025
54	Campo Grande	54014020
54	Campo Ramón	54091020
54	Campo Viera	54091030
54	Candelaria	54021020
54	Capioviciño	54077015
54	Capioví	54077010
54	Caraguatay	54084010
54	Caá - Yarí	54070030
54	Cerro Azul	54070040
54	Cerro Corá	54021030
54	Cerro Moreno	54014025
54	Colonia 9 de Julio	54119032
54	Colonia Acaragua	54119028
54	Colonia Alberdi	54091010
54	Colonia Aurora	54119030
54	Colonia Finlandesa	54091033
54	Colonia Gisela	54098007
54	Colonia Gisela	54098008
54	Colonia Julio U. Martín	54091035
54	Colonia Polana	54098010
54	Colonia Victoria	54042010
54	Colonia Wanda	54063040
54	Comandante Andresito	54049010
54	Concepción de la Sierra	54035020
54	Corpus	54098020
54	Cruce Caballero	54112010
54	Domingo Savio	54098030
54	Dos Arroyos	54070050
54	Dos Hermanas	54049030
54	Dos de Mayo	54014030
54	Dos de Mayo Nucleo III (Bº Bernardino Rivadavia)	54014050
54	Dos de Mayo Núcleo I	54014030
54	Dos de Mayo Núcleo II	54014030
54	El Alcázar	54077020
54	El Salto	54091040
54	El Soberbio	54056010
54	Eldorado	54042020
54	Escuela 357	54112012
54	Estación Apóstoles	54007030
54	Fachinal	54028007
54	Florentino Ameghino	54105010
54	Fracrán	54056020
54	Garuhapé	54077030
54	Garupá	54028010
54	General Alvear	54091050
54	General Urquiza	54098040
54	Gobernador López	54070060
54	Gobernador Roca	54098050
54	Guaraní	54091060
54	Helvecia	54098060
54	Hipólito Yrigoyen	54098070
54	Integración	54049040
54	Itacaruaré	54105020
54	Jardín América	54098080
54	Juan Manuel de Rosas	54049041
54	Kilómetro 130	54049042
54	Kilómetro 17	54014055
54	Kilómetro 26	54070065
54	Kilómetro 74	54056022
54	Kilómetro 84	54056023
54	La Africana	54091065
54	La Corita	54035030
54	Laguna Azul	54049060
54	Laguna Azul	54112015
54	Laharrague	54084020
54	Leandro N. Alem	54070070
54	Loreto	54021040
54	Los Helechos	54091070
54	Los Teales	54077035
54	Los Teales	54098085
54	Mai Bao	54119034
54	Margarita	54056025
54	María Magdalena	54042030
54	Mbopicuá	54077040
54	Mojón Grande	54105030
54	Montecarlo	54084030
54	Mártires	54021050
54	Nemesio Parma	54028020
54	Nueva Delicia	54042035
54	Oasis	54098090
54	Oberá	54091080
54	Olegario V. Andrade	54070080
54	Panambi Kilómetro 15	54091105
54	Panambí	54091090
54	Panambí Kilómetro 8	54091100
54	Paraje Aristóbulo Chico	54119035
54	Paraje Dorado	54119036
54	Paraje Itá Chica	54091106
54	Paraje La Reserva	54091107
54	Paraje Los Cedros	54105035
54	Paraje Monyolito	54007037
54	Paraje Ruta 6	54091108
54	Paraje Sargento Cabral	54091109
54	Paraje Teyú Cuaré	54098093
54	Paraíso	54112020
54	Pastoreo	54098095
54	Picada 37	54056027
54	Pindapoy	54007040
54	Piray Kilómetro 18	54084040
54	Piñalito Norte	54049043
54	Piñalito Sur	54112030
54	Posadas	54028030
54	Posadas (Expansión)	54028040
54	Posadas (Extensión)	54028040
54	Pozo Azul	54112035
54	Primavera	54119037
54	Profundidad	54021060
54	Pueblo Illia	54014070
54	Pueblo Nuevo	54042055
54	Puerto Andresito	54049045
54	Puerto Deseado	54049047
54	Puerto Esperanza	54063010
54	Puerto Iguazú	54063030
54	Puerto Leoni	54077050
54	Puerto Libertad	54063020
54	Puerto Mado	54042060
54	Puerto Nuevo	54098097
54	Puerto Pinares	54042070
54	Puerto Piray	54084050
54	Puerto Rico	54077060
54	Puerto Santa Ana	54021070
54	Rincón de Azara	54007050
54	Roca Chica	54098100
54	Ruiz de Montoya	54077070
54	Salto Encantado	54014080
54	San Alberto	54077080
54	San Alfonso	54056029
54	San Antonio	54049050
54	San Cayetano	54063033
54	San Francisco de Asís	54119040
54	San Gotardo	54077090
54	San Ignacio	54098110
54	San Javier	54105040
54	San José	54007060
54	San Martín	54091110
54	San Miguel	54077100
54	San Pedro	54112040
54	San Vicente	54056030
54	Santa Ana	54021080
54	Santa María	54035040
54	Santa Rita	54119050
54	Santiago de Liniers	54042080
54	Santo Pipó	54098120
54	Sargento Cabral	54056040
54	Tacuara	54098130
54	Tarumá	54084060
54	Tobuna	54112050
54	Tres Capones	54007070
54	Valle Hermoso	54042090
54	Villa Akerman	54077110
54	Villa Bonita	54091120
54	Villa Cooperativa	54063035
54	Villa Libertad	54070090
54	Villa Parodi	54084070
54	Villa Parodi	54084071
54	Villa Roulet	54042100
54	Villa Urrutia	54077120
54	Yacutinga	54098140
58	Aeropuerto Chapelco	58056003
58	Aguada San Roque	58014005
58	Aluminé	58007010
58	Andacollo	58077010
58	Arroyito	58035010
58	Azul Pescador	58035012
58	Añelo	58014010
58	Bahía Bonita	58035014
58	Bahía de Playas	58035016
58	Bajada del Agrio	58105010
58	Barrancas	58091010
58	Buta Ranquil	58091020
58	Butalón Norte	58077013
58	Caviahue	58084010
58	Centenario	58035030
58	Chocón Medio	58098003
58	Chorriaca	58063010
58	Chos Malal	58042010
58	Cochico	58042013
58	Copahue	58084020
58	Covunco Centro	58112020
58	Cutral Có	58035040
58	El Alamito	58042015
58	El Cholar	58084030
58	El Cristo	58112005
58	El Huecú	58084040
58	El Sauce	58098005
58	Guañacos	58077017
58	Huinganco	58077020
58	Junín de los Andes	58049010
58	La Buitrera	58105020
58	La Península	58035055
58	Las Coloradas	58021010
58	Las Lajas	58105030
58	Las Ovejas	58077030
58	Loncopué	58063020
58	Los Barreales	58035057
58	Los Carrizos	58077070
58	Los Catutos	58112010
58	Los Chihuidos	58014015
58	Los Menucos	58042030
58	Los Miches	58077040
58	Manzano Amargo	58077050
58	Mari Menuco	58035060
58	Mariano Moreno	58112020
58	Moquehue	58007015
58	Neuquén	58035070
58	Octavio Pico	58091030
58	Parque Diana	58056005
58	Paso Aguerre	58098010
58	Picún Leufú	58098020
58	Piedra del Águila	58028010
58	Pilo Lil	58021020
58	Plaza Huincul	58035090
58	Plottier	58035100
58	Quili Malal	58105040
58	Ramón M. Castro	58112030
58	Rincón de los Sauces	58091040
58	San Martín de los Andes	58056010
58	San Patricio del Chañar	58014020
58	Santo Tomás	58028020
58	Sauzal Bonito	58035107
58	Senillosa	58035110
58	Taquimilán	58084050
58	Tricao Malal	58042020
58	Varvarco	58077060
58	Villa El Chocón	58035120
58	Villa Huechulafquen	58049020
58	Villa La Angostura	58070010
58	Villa Lago Meliquina	58056020
58	Villa Lolog	58049030
58	Villa Pehuenia	58007020
58	Villa Tenis Club Neuquén	58035125
58	Villa Traful	58070020
58	Villa del Curi Leuvú	58042030
58	Villa del Nahueve	58077070
58	Villa del Sol	58035115
58	Vista Alegre Norte	58035130
58	Vista Alegre Sur	58035140
58	Yacht Club Neuquén	58035150
58	Zapala	58112040
62	Aguada Cecilio	62084010
62	Aguada Guzmán	62035010
62	Aguada de Guerra	62091010
62	Allen	62042010
62	Arroyo Los Berros	62084020
62	Arroyo Ventana	62084030
62	Bahía Creek	62007010
62	Barda del Medio	62042030
62	Barrio Alta Barda	62042035
62	Barrio Blanco	62042040
62	Barrio Buenos Aires Chico	62042045
62	Barrio Calle Ciega Nº 10	62042050
62	Barrio Calle Ciega Nº 6	62042060
62	Barrio Canale	62042070
62	Barrio Ceferino	62042075
62	Barrio Chacra Monte	62042080
62	Barrio Colonia Conesa	62028010
62	Barrio Costa Este	62042090
62	Barrio Costa Oeste	62042110
62	Barrio Destacamento	62042115
62	Barrio El Labrador	62042120
62	Barrio El Maruchito	62042130
62	Barrio El Petróleo	62042140
62	Barrio Emergente	62042143
62	Barrio Esperanza	62063005
62	Barrio Frontera	62042150
62	Barrio Fátima	62042147
62	Barrio Guerrico	62042160
62	Barrio Isla 10	62042170
62	Barrio La Barda	62042180
62	Barrio La Costa	62042200
62	Barrio La Costa	62042201
62	Barrio La Defensa	62042210
62	Barrio La Herminia	62042213
62	Barrio La Herradura	62042215
62	Barrio La Lor	62042400
62	Barrio La Luna	62042224
62	Barrio Luisillo	62042245
62	Barrio Mar del Plata	62042250
62	Barrio Marengo	62042255
62	Barrio María Elvira	62042260
62	Barrio Moño Azul	62042265
62	Barrio Norte	62042280
62	Barrio Pinar	62042297
62	Barrio Pino Azul	62042450
62	Barrio Planta Compresora de Gas	62028030
62	Barrio Porvenir	62042310
62	Barrio Presidente Perón	62042390
62	Barrio Santa Lucia	62042335
62	Barrio Santa Rita	62042340
62	Barrio Tronelli	62042345
62	Barrio Unión	62014010
62	Barrio Unión	62042350
62	Blancura Centro	62070003
62	Catriel	62042360
62	Cañadón Chileno	62070005
62	Cerro Policía	62035020
62	Cervantes	62042370
62	Chelforó	62014020
62	Chichinales	62042380
62	Chimpay	62014030
62	Choele Choel	62014040
62	Cinco Saltos	62042390
62	Cipolletti	62042400
62	Clemente Onelli	62091020
62	Colan Conhue	62091030
62	Colonia Juliá y Echarren	62063010
62	Colonia Suiza	62021020
62	Comallo	62070010
62	Comicó	62049010
62	Cona Niyeu	62049020
62	Contralmirante Cordero	62042410
62	Coronel Belisle	62014050
62	Corralito	62070015
62	Costa Blanco	62042415
62	Darwin	62014060
62	Dina Huapi	62070020
62	El Bolsón	62021030
62	El Caín	62091040
62	El Cuy	62035030
62	El Cóndor	62007020
62	El Empalme	62077005
62	El Foyel	62021040
62	El Juncal	62007030
62	El Pescadero	62007035
62	El Sótano	62077007
62	Estación Ñorquinco	62056005
62	Ferri	62042420
62	General Conesa	62028020
62	General Enrique Godoy	62042430
62	General Fernández Oro	62042440
62	General Roca	62042450
62	Guardia Mitre	62007040
62	Ingeniero Jacobacci	62091050
62	Ingeniero Luis A. Huergo	62042460
62	Ingeniero Otto Krause	62042470
62	Juventud Unida	62063013
62	La Lobería	62007050
62	Lago Moreno	62021042
62	Laguna Blanca	62070030
62	Lamarque	62014070
62	Las Bayas	62056010
62	Las Cartas	62021044
62	Las Grutas	62077010
62	Las Perlas	62035040
62	Los Menucos	62091060
62	Los Repollos	62021045
62	Loteo Costa de Río	62007060
62	Luis Beltrán	62014080
62	Mainqué	62042480
62	Mallín Ahogado	62021047
62	Mamuel Choique	62056020
62	Maquinchao	62091070
62	Martín Fierro	62042485
62	Mencué	62035050
62	Ministro Ramos Mexía	62049030
62	Nahuel Niyeu	62084040
62	Naupa Huen	62035060
62	Ojos de Agua	62056040
62	Paraje Arroyón (Bajo San Cayetano)	62042020
62	Paso Córdova	62035070
62	Paso Córdova	62042490
62	Paso Flores	62070050
62	Península Ruca Co	62042500
62	Pichi Mahuida	62063017
62	Pilcaniyeu	62070060
62	Pilquiniyeu	62091090
62	Pilquiniyeu del Limay	62070070
62	Playas Doradas	62077020
62	Pomona	62014090
62	Pozo Salado	62007070
62	Prahuaniyeu	62049040
62	Puente Cero	62042240
62	Puerto San Antonio Este	62077030
62	Punta Colorada	62077040
62	Río Chico	62056050
62	Río Colorado	62063020
62	Río Villegas	62021050
62	Saco Viejo	62077045
62	Salto Andersen	62063060
62	San Antonio Oeste	62077050
62	San Carlos de Bariloche	62021060
62	San Javier	62007080
62	Sargento Vidal	62042520
62	Sierra Colorada	62049050
62	Sierra Grande	62077060
62	Sierra Pailemán	62084050
62	Treneta	62049060
62	Valcheta	62084060
62	Valle Azul	62035080
62	Viedma	62007090
62	Villa Alberdi	62042530
62	Villa Campanario	62021060
62	Villa Catedral	62021080
62	Villa Llanquín	62070080
62	Villa Llao Llao	62021060
62	Villa Manzano	62042550
62	Villa Mascardi	62021110
62	Villa Regina	62042560
62	Villa San Isidro	62042570
62	Villa del Parque	62042540
62	Yaminué	62049070
62	Ñirihuau	62070040
62	Ñorquincó	62056030
66	Acoyte	66161010
66	Aguaray	66056010
66	Aguas Blancas	66126010
66	Alemanía	66063003
66	Almirante Brown	66140005
66	Alto de la Sierra	66133010
66	Amblayo	66154005
66	Ampascachi	66098010
66	Angastaco	66154010
66	Animaná	66154020
66	Antilla	66140010
66	Antillá	66140010
66	Apolinario Saravia	66007010
66	Barrio Finca La Maroma	66042003
66	Barrio La Rotonda	66042005
66	Barrio Retoños de Colón	66147005
66	Barrio Santa Teresita	66042007
66	Betania	66049005
66	Cabeza de Buey	66049007
66	Cabra Corral	66098020
66	Cachi	66014010
66	Cafayate	66021010
66	Campichuelo	66056030
66	Campo Durán	66056040
66	Campo La Cruz	66161020
66	Campo La Paz	66161023
66	Campo Quijano	66147010
66	Campo Santo	66049010
66	Capiazuti	66056050
66	Capitán Juan Pagé	66133020
66	Caraparí	66056055
66	Carboncito	66056060
66	Ceibalito	66007020
66	Centro 25 de Junio	66007030
66	Cerrillos	66035010
66	Cerro Negro	66091005
66	Chicoana	66042010
66	Cielos del Sur	66035012
66	Cobos	66028015
66	Cobos	66049020
66	Cobres	66091010
66	Colonia Santa Rosa	66126020
66	Copo Quile	66140020
66	Coronel Cornejo	66056070
66	Coronel Juan Solá	66133030
66	Coronel Moldes	66098030
66	Coronel Mollinedo	66007040
66	Coronel Olleros	66007050
66	Coropampa	66063007
66	Cortaderas	66070005
66	Country Club El Tipal	66028050
66	Country Club La Almudena	66028050
66	Cuesta Azul	66161015
66	Dragones	66056080
66	El Bordo	66049030
66	El Carmen	66098035
66	El Carril	66042020
66	El Galpón	66112010
66	El Jardín	66084010
66	El Jardí­n	66084010
66	El Mollar	66042007
66	El Mollar	66042008
66	El Naranjo	66140030
66	El Potrero	66140040
66	El Préstamo	66098037
66	El Pucará	66147013
66	El Quebrachal	66007060
66	El Sauce	66049035
66	El Tabacal	66126030
66	El Tala	66084020
66	El Tunal	66112020
66	Embarcación	66056090
66	Gaona	66007070
66	General Ballivián	66056100
66	General Güemes	66049040
66	General Mosconi	66056110
66	General Pizarro	66007080
66	Guachipas	66063010
66	Hickman	66056120
66	Hipólito Yrigoyen	66126040
66	Hito 1	66133035
66	Iruya	66070010
66	Isla de Cañas	66070020
66	Joaquín V. Gonzalez	66007090
66	Joaquín V. González	66007090
66	La Caldera	66077010
66	La Calderilla	66077013
66	La Candelaria	66084030
66	La Merced	66035020
66	La Merced	66133037
66	La Merced del Encón	66147015
66	La Misión	66126020
66	La Pedrera	66035023
66	La Poma	66091020
66	La Puerta	66119010
66	La Silleta	66147020
66	La Unión	66133040
66	La Viña	66098040
66	Las Lajitas	66007100
66	Las Palmas	66035025
66	Lizoite	66161027
66	Los Baños	66140045
66	Los Blancos	66133050
66	Los Naranjos	66126055
66	Los Toldos	66161030
66	Luis Burela	66007110
66	Lumbreras	66112030
66	Macapillo	66007120
66	Mecoyita	66161035
66	Misión Chaqueña	66056130
66	Misión Kilómetro 6	66056150
66	Misión La Paz	66133055
66	Misión Tierras Fiscales	66056090
66	Molinos	66119020
66	Nazareno	66161040
66	Nuestra Señora de Talavera	66007130
66	Olacapato	66105010
66	Pacará	66056170
66	Padre Lozano	66056180
66	Palermo Oeste	66014017
66	Payogasta	66014020
66	Pichanal	66126060
66	Piquete Cabado	66007140
66	Piquirenda	66056190
66	Pluma de Pato	66133060
66	Poscaya	66161050
66	Profesor Salvador Mazza	66056200
66	Pueblo Viejo	66070030
66	Recaredo	66056110
66	Rivadavia	66133070
66	Rodeo Colorado	66070040
66	Rosario de Lerma	66147030
66	Rosario de la Frontera	66140050
66	Río Blanquito	66126065
66	Río Piedras	66112070
66	Río del Valle	66007150
66	Rí­o Piedras	66112070
66	Rí­o del Valle	66007150
66	Saladillo	66098045
66	Salar de Pocitos	66105017
66	Salta	66028050
66	San Agustín	66035030
66	San Antonio de los Cobres	66105020
66	San Carlos	66154040
66	San Felipe	66140060
66	San Isidro	66070050
66	San José de Escalchi	66014030
66	San José de Metán	66112040
66	San José de Metán (Est. Metán)	66112040
66	San José de Orquera	66112080
66	San José de los Cerrillos	66035010
66	San Lorenzo	66028060
66	San Lorenzo	66140070
66	San Marcos	66161060
66	San Ramón de la Nueva Orán	66126070
66	Santa María	66133080
66	Santa Marí­a	66133080
66	Santa Marí­a de Yariguarenda	66056215
66	Santa Rosa	66133090
66	Santa Rosa de los Pastos Grandes	66105030
66	Santa Victoria	66161070
66	Santa Victoria Este	66133100
66	Seclantás	66119030
66	Talapampa	66098050
66	Tartagal	66056220
66	Terrazas del Río	66035035
66	Tobantirenda	66056230
66	Tolar Grande	66105040
66	Tolloche	66007160
66	Tolombón	66021020
66	Tranquitas	66056240
66	Urundel	66126080
66	Vaqueros	66077020
66	Villa San Lorenzo	66028060
66	Villa Sarmiento	66035050
66	Vizcachani	66161080
66	Yacuy	66056250
66	Zanja Honda	66056260
70	9 de Julio	70063040
70	Alto de Sierra	70063010
70	Angualasto	70049010
70	Astica	70119010
70	Balde del Rosario	70119020
70	Barreal - Villa Pituil	70021010
70	Barrio Municipal	70070005
70	Barrio Ruta 40	70070010
70	Barrio Sadop - Bella Vista	70091010
70	Bermejo	70035010
70	Calingasta	70021020
70	Carpintería	70070020
70	Caucete	70035020
70	Cañada Honda	70105010
70	Chimbas	70042010
70	Chucuma	70119030
70	Cienaguita	70105020
70	Cochagual	70105025
70	Colonia Fiscal	70105030
70	Colonia Gutiérrez	70098010
70	Costa del Lago	70112003
70	Divisadero	70105040
70	Divisoria	70035025
70	Dos Acequias	70091020
70	El Carrizal	70021025
70	El Encón	70126010
70	El Medanito	70077010
70	El Médano	70056010
70	El Rincón	70007010
70	El Rincón	70035030
70	Entre Ríos	70056015
70	Gran China	70056020
70	Huaco	70056030
70	Iglesia	70049030
70	La Chimbera	70126030
70	La Falda	70056060
70	La Isla	70021027
70	La Puntilla	70035037
70	La Rinconada	70070040
70	Las Chacritas	70063030
70	Las Flores	70049040
70	Las Lagunas	70105060
70	Las Talas	70035040
70	Las Talas - Los Médanos	70035040
70	Las Tapias	70014010
70	Los Baldecitos	70119040
70	Los Berros	70105070
70	Los Médanos	70035040
70	Marayes	70035050
70	Mogna	70056040
70	Niquivil	70056050
70	Pampa Vieja	70056060
70	Pedernal	70105080
70	Pie de Palo	70035060
70	Pismanta	70049050
70	Pozo de los Algarrobos	70035063
70	Punta del Médano	70105090
70	Quinto Cuartel	70070030
70	Rawson	70077010
70	Rivadavia	70084010
70	Rodeo	70049060
70	San Isidro	70056070
70	San Isidro	70091030
70	San José de Jáchal	70056080
70	San Juan	70028010
70	Santa Lucía	70098010
70	Tamberías	70021030
70	Tamberías	70056090
70	Tres Esquinas	70105095
70	Tudcum	70049070
70	Tupelí	70126020
70	Usno	70119050
70	Vallecito	70035070
70	Villa Aberastain	70070040
70	Villa Aberastain - La Rinconada	70070040
70	Villa Barboza	70070050
70	Villa Barboza - Villa Nacusi	70070050
70	Villa Basilio Nievas	70133010
70	Villa Bolaños (Médano de Oro)	70077020
70	Villa Borjas	70126030
70	Villa Borjas - La Chimbera	70126030
70	Villa Centenario	70070060
70	Villa Dominguito	70091050
70	Villa Don Bosco	70091060
70	Villa El Salvador	70014020
70	Villa El Salvador - Villa Sefair	70014020
70	Villa El Tango	70126040
70	Villa General San Martín - Campo Afuera	70007020
70	Villa Ibáñez	70112010
70	Villa Independencia	70035080
70	Villa Malvinas Argentinas	70056100
70	Villa Media Agua	70105100
70	Villa Mercedes	70056110
70	Villa Nacusi	70070050
70	Villa San Agustín	70119060
70	Villa San Martín	70091070
70	Villa Santa Rosa	70126050
70	Villa Sefair	70014020
70	Villa Tacú	70133010
70	Villa del Salvador	70091040
74	5ta Brigada	74035080
74	Aguadita del Portezuelo	74056005
74	Alto Pelado	74056010
74	Alto Pencoso	74056020
74	Anchorena	74042010
74	Arizona	74042020
74	Bagual	74042030
74	Balde	74056030
74	Barrio 270 Viviendas	74049005
74	Batavia	74042040
74	Beazley	74056040
74	Buena Esperanza	74042050
74	Candelaria	74007010
74	Carolina	74021010
74	Carpintería	74049010
74	Cazador	74056050
74	Cerro Colorado	74056100
74	Chosmes	74056060
74	Concarán	74028010
74	Cortaderas	74028020
74	Country Club Los Caldenes	74035080
74	Cruz de Piedra	74056100
74	Daniel Donovan	74056065
74	Daniel Donovan	74056066
74	Desaguadero	74056070
74	El Chorrillo	74056100
74	El Milagro	74014005
74	El Trapiche	74021020
74	El Volcán	74056080
74	Estancia Grande	74021025
74	Fortuna	74042070
74	Fortín El Patria	74042060
74	Fraga	74021030
74	Jarilla	74056090
74	Juan Jorba	74035010
74	Juan Llerena	74035020
74	Juan Wenceslao Gez	74056095
74	Juana Koslay	74056100
74	Justo Daract	74035030
74	La Calera	74014010
74	La Carolina	74021010
74	La Florida	74021050
74	La Majada	74007020
74	La Maroma	74042080
74	La Punilla	74035040
74	La Punta	74056105
74	La Ribera	74035070
74	La Toma	74021060
74	La Vertiente	74063010
74	Lafinur	74049030
74	Las Aguadas	74063020
74	Las Barranquitas	74021063
74	Las Chacras	74056100
74	Las Chacras	74063030
74	Las Lagunas	74063040
74	Lavaisse	74035050
74	Leandro N. Alem	74007030
74	Los Cajones	74049040
74	Los Manantiales	74014040
74	Los Molles	74014015
74	Los Molles	74049050
74	Los Overos	74042090
74	Los Puquios	74056107
74	Los Puquios	74056108
74	Luján	74007040
74	Martín de Loyola	74042100
74	Merlo	74049060
74	Mosmota	74056110
74	Nación Ranquel	74035055
74	Nahuel Mapá	74042110
74	Naschel	74028030
74	Navia	74042120
74	Nogolí	74014020
74	Nueva Galia	74042130
74	Papagayos	74028040
74	Paso Grande	74063050
74	Paso de las Carretas	74021065
74	Potrerillo	74063060
74	Potrero de los Funes	74056120
74	Quines	74007050
74	Renca	74028050
74	Riocito	74021070
74	Río Juan Gómez	74007060
74	Saladillo	74021090
74	Salinas del Bebedero	74056130
74	San Francisco del Monte de Oro	74007070
74	San Jerónimo	74056140
74	San José del Morro	74035060
74	San Luis	74056150
74	San Martín	74063070
74	San Pablo	74028060
74	San Roque	74056100
74	Santa Rosa del Conlara	74049070
74	Suyuque Nuevo	74056153
74	Talita	74049080
74	Tilisarao	74028070
74	Unión	74042140
74	Villa General Roca	74014040
74	Villa Larca	74028090
74	Villa Mercedes	74035070
74	Villa Reynolds	74035080
74	Villa Salles	74035090
74	Villa de Merlo	74049060
74	Villa de Praga	74063080
74	Villa de la Quebrada	74014030
74	Villa del Carmen	74028080
74	Zanjitas	74056160
78	28 de Noviembre	78021060
78	Bajo Caracoles	78049010
78	Caleta Olivia	78014010
78	Cañadón Seco	78014020
78	Chimen Aike	78021005
78	Comandante Luis Piedrabuena	78007010
78	El Calafate	78028010
78	El Chaltén	78028020
78	El Turbio	78021010
78	Esperanza	78021015
78	Fitz Roy	78014030
78	Gobernador Gregores	78049020
78	Hipólito Yrigoyen	78049030
78	Jaramillo	78014040
78	Julia Dufour	78021020
78	Koluel Kaike	78014050
78	Lago Posadas	78049030
78	Las Heras	78014060
78	Los Antiguos	78035010
78	Nuestra Señora de los Dolores de Koluel Kayke	78014050
78	Perito Moreno	78035020
78	Pico Truncado	78014070
78	Puerto Deseado	78014080
78	Puerto San Julián	78042010
78	Puerto Santa Cruz	78007020
78	Rospentek	78021050
78	Río Gallegos	78021040
78	Tellier	78014090
78	Tres Lagos	78028030
78	Yacimientos Río Turbio	78021070
82	Aarón Castellanos	82042010
82	Acébal	82084010
82	Aguará Grande	82091010
82	Albarellos	82084020
82	Alcorta	82028010
82	Aldao	82021010
82	Aldao	82119010
82	Alejandra	82098010
82	Alvear	82084040
82	Ambrosetti	82091020
82	Amenábar	82042020
82	Angel Gallardo	82063010
82	Angeloni	82112010
82	Angélica	82021020
82	Arbilla	82084050
82	Arequito	82014010
82	Arminda	82084060
82	Armstrong	82007010
82	Arocena	82105010
82	Arroyo Aguiar	82063020
82	Arroyo Ceibal	82049010
82	Arroyo Leyes	82063030
82	Arroyo Seco	82084070
82	Arrufo	82091030
82	Arteaga	82014020
82	Ataliva	82021030
82	Aurelia	82021040
82	Avellaneda	82049020
82	Balneario La Verde	82091040
82	Balneario Monje	82105020
82	Barrancas	82105030
82	Barrio Arroyo del Medio	82028020
82	Barrio Caima	82105040
82	Barrio Cicarelli	82056010
82	Barrio El Pacaá - Barrio Comipini	82105050
82	Barrio Mitre	82028030
82	Barrios Acapulco y Veracruz	82021050
82	Bauer y Sigel	82021060
82	Bella Italia	82021070
82	Beravebú	82014030
82	Berna	82049030
82	Bernardo de Irigoyen	82105060
82	Bigand	82014040
82	Bombal	82028040
82	Bouquet	82007020
82	Bustinza	82056020
82	Cabal	82063040
82	Cacique Ariacaiquín	82098020
82	Cafferata	82042030
82	Calchaquí	82133010
82	Campo Andino	82063050
82	Campo Siete Provincias	82049035
82	Candioti	82063060
82	Capitán Bermúdez	82119020
82	Capivara	82091050
82	Carcarañá	82119030
82	Carlos Pellegrini	82126020
82	Carmen	82042050
82	Carmen del Sauce	82084080
82	Carreras	82042060
82	Carrizales	82056040
82	Casalegno	82105070
82	Casas	82126030
82	Casilda	82014050
82	Castelar	82126040
82	Castellanos	82021080
82	Cavour	82070010
82	Cayastacito	82112020
82	Cayastá	82035010
82	Cañada Ombú	82133020
82	Cañada Rica	82028050
82	Cañada Rosquín	82126010
82	Cañada de Gómez	82056030
82	Cañada del Ucle	82042040
82	Centeno	82105080
82	Cepeda	82028060
82	Ceres	82091060
82	Chabas	82014060
82	Chapuy	82042070
82	Chañar Ladeado	82014070
82	Chovet	82042080
82	Christophersen	82042090
82	Classon	82056050
82	Colmena	82133030
82	Colonia Ana	82091070
82	Colonia Belgrano	82126050
82	Colonia Bicha	82021090
82	Colonia Bossi	82091080
82	Colonia Cello	82021100
82	Colonia Dolores	82112030
82	Colonia Durán	82098030
82	Colonia Margarita	82021110
82	Colonia Mascías	82035015
82	Colonia Médici	82056060
82	Colonia Nueva	82070015
82	Colonia Raquel	82021120
82	Colonia Rosa	82091090
82	Colonia San Joaquín	82035045
82	Colonia San José	82070017
82	Colonia San José	82098033
82	Colonia Tacurales	82021125
82	Colonia Teresa	82098035
82	Constanza	82091100
82	Coronda	82105090
82	Coronel Arnold	82119040
82	Coronel Bogado	82084090
82	Coronel Domínguez	82084100
82	Coronel Fraga	82021130
82	Coronel Rodolfo S. Domínguez	82084100
82	Correa	82056070
82	Crispi	82126060
82	Cuatro Esquinas	82084110
82	Cululú	82070020
82	Curupaytí	82091110
82	Desvío Arijón	82105100
82	Diego de Alvear	82042100
82	Díaz	82105110
82	Egusquiza	82021140
82	El Araza	82049040
82	El Caramelo	82084120
82	El Carmen de Avellaneda	82049045
82	El Rabón	82049050
82	El Sombrerito	82049053
82	El Trébol	82126070
82	Elisa	82070030
82	Elortondo	82042110
82	Emilia	82063070
82	Empalme San Carlos	82070040
82	Empalme Villa Constitución	82028070
82	Esmeralda	82021150
82	Esperanza	82070050
82	Estación Clucellas	82021160
82	Estación Kilómetro 403	82049055
82	Estación Kilómetro 501	82021163
82	Estación Presidente Roca	82021290
82	Estación Saguier	82021170
82	Esteban Rams	82077010
82	Esther	82112040
82	Eusebia y Carolina	82021180
82	Eustolia	82021190
82	Felicia	82070060
82	Fighiera	82084130
82	Firmat	82028080
82	Firmat	82042120
82	Flor de Oro	82049058
82	Florencia	82049060
82	Fortín Charrúa	82133037
82	Fortín Olmos	82133040
82	Franck	82070070
82	Fray Luis Beltrán	82119050
82	Frontera	82021200
82	Fuentes	82119060
82	Funes	82084140
82	Gaboto	82105120
82	Garabato	82133050
82	Garibaldi	82021210
82	Gato Colorado	82077020
82	General Gelly	82028090
82	General Lagos	82084150
82	Gessler	82105140
82	Gobernador Crespo	82112050
82	Godoy	82028100
82	Golondrina	82133060
82	Granadero Baigorria	82084160
82	Gregoria Pérez de Denis	82077030
82	Grutly	82070080
82	Guadalupe Norte	82049070
82	Gálvez	82105130
82	Gödeken	82014080
82	Hardy	82049075
82	Helvecia	82035020
82	Hersilia	82091120
82	Hipatía	82070090
82	Huanqueros	82091130
82	Hughes	82042130
82	Humberto Primo	82021220
82	Humboldt	82070100
82	Ibarlucea	82084170
82	Ingeniero Chanourdie	82049080
82	Intiyaco	82133070
82	Irigoyen	82105150
82	Jacinto L. Aráuz	82070110
82	Josefina	82021230
82	Juan B. Molina	82028110
82	Juncal	82028120
82	Kilómetro 101	82084180
82	Kilómetro 115	82133080
82	Kilómetro 12	82133075
82	Kilómetro 302	82133085
82	La Brava	82098040
82	La Cabral	82091140
82	La Chispa	82042140
82	La Criolla	82112060
82	La Gallareta	82133090
82	La Isleta	82049090
82	La Lucila	82091145
82	La Pelada	82070120
82	La Penca y Caraguatá	82112070
82	La Reserva	82049095
82	La Rubia	82091150
82	La Sarita	82049100
82	La Vanguardia	82028130
82	Labordeboy	82042150
82	Laguna Paiva	82063080
82	Landeta	82126080
82	Lanteri	82049110
82	Larguía	82056080
82	Larrechea	82105160
82	Las Avispas	82091160
82	Las Bandurrias	82126090
82	Las Garzas	82049120
82	Las Palmas	82049127
82	Las Palmeras	82091170
82	Las Parejas	82007030
82	Las Petacas	82126100
82	Las Rosas	82007040
82	Las Toscas	82049130
82	Las Tunas	82070130
82	Lazzarino	82042160
82	Lehmann	82021240
82	Llambi Campbell	82063090
82	Logroño	82077040
82	Loma Alta	82105170
82	Los Amores	82133100
82	Los Cardos	82126110
82	Los Laureles	82049140
82	Los Molinos	82014090
82	Los Muchachos - La Alborada	82084190
82	Los Nogales	82014100
82	Los Quirquinchos	82014110
82	Los Sembrados	82021245
82	Los Tábanos	82133105
82	Los Zapallos	82035030
82	Lucio V. López	82056090
82	Luis Palacios	82119070
82	López	82105180
82	Maciel	82105190
82	Maggiolo	82042170
82	Malabrigo	82049150
82	Manucho	82063095
82	Marcelino Escalada	82112080
82	Margarita	82133110
82	María Juana	82021250
82	María Luisa	82070140
82	María Susana	82126120
82	María Teresa	82042180
82	Matilde	82070150
82	Melincué	82042190
82	Miguel Torres	82042200
82	Moisés Ville	82091180
82	Monigotes	82091190
82	Monje	82105200
82	Monte Flores	82084200
82	Monte Vera	82063100
82	Montefiore	82077050
82	Montes de Oca	82007050
82	Moussy	82049153
82	Murphy	82042210
82	Máximo Paz	82028140
82	Naré	82112090
82	Nelson	82063110
82	Nicanor Molinas	82049155
82	Nueva Lehmann	82021260
82	Nuevo Torino	82070160
82	Oliveros	82056100
82	Palacios	82091210
82	Paraje 29	82133120
82	Paraje Chaco Chico	82063120
82	Paraje La Costa	82063130
82	Paraje San Manuel	82049160
82	Pavón	82028150
82	Pavón Arriba	82028160
82	Pedro Gómez Cello	82112100
82	Peyrano	82028170
82	Piamonte	82126130
82	Pilar	82070170
82	Piñero	82084220
82	Plaza Clucellas	82021270
82	Plaza Matilde	82070180
82	Plaza Saguier	82021280
82	Pozo Borrado	82077060
82	Pozo de los Indios	82133130
82	Presidente Roca	82021290
82	Progreso	82070190
82	Providencia	82070200
82	Pueblo Andino	82056110
82	Pueblo Esther	82084230
82	Pueblo Luis Berli	82133135
82	Pueblo Marini	82021300
82	Pueblo Muñóz	82084240
82	Pueblo Santa Lucía	82133140
82	Pueblo Uranga	82084250
82	Puerto Aragón	82105210
82	Puerto Arroyo Seco	82084260
82	Puerto General San Martín	82119080
82	Puerto Reconquista	82049170
82	Pujato	82119090
82	Pujato Norte	82070205
82	Pérez	82084210
82	Rafaela	82021310
82	Ramayón	82112110
82	Ramona	82021320
82	Reconquista	82049180
82	Recreo	82063140
82	Ricardone	82119100
82	Rincón Norte	82063030
82	Rincón Potrero	82063150
82	Roldán	82119110
82	Romang	82098050
82	Rosario	82084270
82	Rueda	82028180
82	Rufino	82042220
82	Sa Pereyra	82070210
82	Saladero Mariano Cabal	82035040
82	Salto Grande	82056120
82	San Agustín	82070220
82	San Antonio	82021330
82	San Antonio de Obligado	82049190
82	San Bernardo	82077065
82	San Bernardo	82112120
82	San Carlos Centro	82070230
82	San Carlos Norte	82070240
82	San Carlos Sud	82070250
82	San Cristóbal	82091220
82	San Eduardo	82042230
82	San Eugenio	82105220
82	San Fabián	82105230
82	San Francisco de Santa Fe	82042240
82	San Genaro	82105240
82	San Genaro Norte	82105250
82	San Gregorio	82042250
82	San Guillermo	82091230
82	San Javier	82098060
82	San Jerónimo Norte	82070270
82	San Jerónimo Sud	82119120
82	San Jerónimo del Sauce	82070260
82	San Jorge	82126140
82	San José de la Esquina	82014120
82	San José del Rincón	82063160
82	San Justo	82112130
82	San Lorenzo	82119130
82	San Mariano	82070280
82	San Martín Norte	82112140
82	San Martín de las Escobas	82126150
82	San Ricardo	82056125
82	San Vicente	82021340
82	Sancti Spiritu	82042260
82	Sanford	82014130
82	Santa Clara de Buena Vista	82070290
82	Santa Clara de Saguier	82021350
82	Santa Fe	82063170
82	Santa Felicia	82133145
82	Santa Isabel	82042270
82	Santa Margarita	82077070
82	Santa Rosa de Calchines	82035050
82	Santa Teresa	82028190
82	Santo Domingo	82070300
82	Santo Tomé	82063180
82	Santurce	82091240
82	Sargento Cabral	82028200
82	Sarmiento	82070310
82	Sastre	82126160
82	Sauce Viejo	82063190
82	Schiffner	82126065
82	Serodino	82056130
82	Silva	82112150
82	Soldini	82084280
82	Soledad	82091250
82	Stephenson	82028210
82	Suardi	82091260
82	Sunchales	82021360
82	Susana	82021370
82	Tacuarendi	82049200
82	Tacuarendí	82049200
82	Tacural	82021380
82	Tartagal	82133150
82	Teodelina	82042280
82	Theobald	82028220
82	Timbúes	82119140
82	Toba	82133160
82	Tortugas	82007060
82	Tostado	82077080
82	Totoras	82056140
82	Traill	82126170
82	Venado Tuerto	82042290
82	Vera	82133170
82	Vera y Pintado	82112160
82	Vicente A. Echeverría	82119145
82	Videla	82112170
82	Vila	82021390
82	Villa Adela	82049207
82	Villa Adelina	82063190
82	Villa Amelia	82084290
82	Villa Ana	82049210
82	Villa Cañás	82042300
82	Villa Constitución	82028230
82	Villa Divisa de Mayo	82042305
82	Villa Eloísa	82056150
82	Villa Elvira	82119150
82	Villa Gobernador Gálvez	82084310
82	Villa Guillermina	82049220
82	Villa Josefina	82021400
82	Villa La Ribera (Oliveros)	82056160
82	Villa La Ribera (Pueblo Andino)	82056170
82	Villa La Rivera (Oliveros)	82056160
82	Villa La Rivera (Pueblo Andino)	82056170
82	Villa Laura	82063200
82	Villa Minetti	82077090
82	Villa Mugueta	82119160
82	Villa Ocampo	82049230
82	Villa San José	82021410
82	Villa Saralegui	82091270
82	Villa Trinidad	82091280
82	Villa del Plata	82084300
82	Villada	82014140
82	Virginia	82021420
82	Wheelwright	82042310
82	Wildermuth	82126180
82	Zavalla	82084320
82	Zenón Pereyra	82021430
82	Álvarez	82084030
82	Ñanducita	82091200
86	Abra Grande	86035010
86	Aerolito	86119010
86	Agua Amarga	86133005
86	Agustina Libarona	86014005
86	Ahí­ Veremos	86133006
86	Alhuampa	86119020
86	Amamá	86119021
86	Ambargasta	86126005
86	Ancaján	86063010
86	Antajé	86035020
86	Ardiles	86035030
86	Argentina	86007010
86	Averías	86077020
86	Añatuya	86077010
86	Bajo Grande	86035035
86	Balde	86133008
86	Bandera	86042010
86	Bandera Bajada	86070010
86	Beltrán	86161010
86	Brea Pozo	86175010
86	Campo Gallo	86014010
86	Cardón Esquina	86070015
86	Casares	86007020
86	Caspi Corral	86070020
86	Cañada Escobar	86035040
86	Cañada de La Costa	86147007
86	Cejolao	86119023
86	Chauchillas	86147020
86	Chaupi Pozo	86035050
86	Chilca Juliana	86168010
86	Choya	86063020
86	Clodomira	86035060
86	Colonia Alpina	86154010
86	Colonia Dora	86028010
86	Colonia El Simbolar	86161020
86	Colonia San Juan	86070030
86	Colonia Tinco	86147030
86	Coronel Manuel L. Rico	86014020
86	Cuatro Bocas	86042020
86	Donadeu	86014030
86	Doña Luisa	86084004
86	El 49	86126010
86	El Arenal	86091005
86	El Bagual	86091008
86	El Bobadal	86091010
86	El Caburé	86056010
86	El Charco	86091020
86	El Charco	86147040
86	El Churqui	86091023
86	El Colorado	86098010
86	El Cruce	86070040
86	El Crucero	86070040
86	El Cuadrado	86098020
86	El Deán	86049010
86	El Deáncito	86049015
86	El Mojón	86049020
86	El Mojón	86133010
86	El Palomar	86091026
86	El Quemado	86133013
86	El Remate	86133015
86	El Rincón	86091030
86	El Rodeo	86063025
86	El Sauzal	86147120
86	El Zanjón	86049030
86	Estación Atamisqui	86021010
86	Estación La Punta	86063030
86	Estación Robles	86175020
86	Estación Taboada	86175030
86	Estación Tacañitas	86077030
86	Fernández	86161030
86	Forres (Est. Chaguar Punco)	86161040
86	Fortín Inca	86042030
86	Fortí­n Inca	86042030
86	Frías	86063040
86	Frí­as	86063040
86	Garza	86182010
86	Gramilla	86091040
86	Gramilla	86147050
86	Granadero Gatica	86119025
86	Guampacha	86084006
86	Guardia Escolta	86042040
86	Hasse	86119030
86	Hernán Mejía Miraval	86119040
86	Herrera	86028020
86	Huachana	86014035
86	Huyamampa	86035070
86	Icaño	86028030
86	Ingeniero Forres	86161040
86	Isca Yacu	86091050
86	Isca Yacu Semaul	86091060
86	Juanillo	86021015
86	La Aurora	86035080
86	La Banda	86035090
86	La Cañada	86070060
86	La Dársena	86035100
86	La Fragua	86133017
86	La Invernada	86070070
86	La Invernada Sur	86070073
86	La Nena	86077040
86	La Nueva Donosa	86147060
86	Laprida	86063050
86	Las Delicias	86133020
86	Las Tinajas	86119050
86	Lavalle	86084010
86	Libertad	86119060
86	Lilo Viejo	86119070
86	Los Acosta	86035105
86	Los Cardozos	86049040
86	Los Gómez	86035107
86	Los Juríes	86077050
86	Los Miranda	86147070
86	Los Nuñez	86147080
86	Los Núñez	86147080
86	Los Pereyra	86161043
86	Los Pirpintos	86056030
86	Los Quiroga	86035110
86	Los Romanos	86161045
86	Los Soria	86035120
86	Los Telares	86168020
86	Los Tigres	86056040
86	Lugones	86028040
86	Maco	86049050
86	Malbrán	86007030
86	Mansupa	86147090
86	Maquito	86049060
86	Matará	86098030
86	Medellín	86021020
86	Medellí­n	86021020
86	Minerva	86070080
86	Monte Quemado	86056050
86	Morales	86049070
86	Nueva Esperanza	86133030
86	Nueva Francia	86189020
86	Otumpa	86119090
86	Palo Negro	86154020
86	Pampa Mayo	86035124
86	Pampa de los Guanacos	86056070
86	Patay	86119080
86	Pinto	86007040
86	Pozo Betbeder	86133040
86	Pozo Hondo	86091070
86	Pozo del Toba	86098035
86	Pozuelos	86147100
86	Pueblo Pablo Torelo	86119090
86	Puesto La Soledad	86147105
86	Puesto de San Antonio	86049080
86	Pérez de Zurita	86147095
86	Quebracho Coto	86133045
86	Quimili	86119100
86	Quimillioj	86070085
86	Ramírez de Velazco	86140010
86	Ramí­rez de Velazco	86140010
86	Rapelli	86133050
86	Real Sayana	86028050
86	Rodeo de Valdez	86147110
86	Roversi	86119110
86	Sachayoj	86014040
86	San Felix	86091076
86	San José Del Boquerón	86056080
86	San José del Boquerón	86056080
86	San Pablo	86147123
86	San Pedro	86049090
86	San Pedro	86063070
86	San Pedro	86084020
86	San Pedro	86091080
86	San Ramón - La Dársena	86035100
86	Santa María	86049100
86	Santa Marí­a	86049100
86	Santiago del Estero	86049110
86	Santo Domingo	86133060
86	Santos Lugares	86014050
86	Sauce Bajada	86035127
86	Selva	86154030
86	Simbol	86189030
86	Simbolar	86035130
86	Sol de Julio	86126020
86	Sol de Mayo	86063075
86	Sotelo	86147126
86	Sumamao	86189040
86	Sumampa	86140020
86	Sumampa Viejo	86140030
86	Suncho Corral	86098040
86	Taboada	86175030
86	Tacañitas	86077030
86	Tapso	86063080
86	Termas de Río Hondo	86147130
86	Termas de Rí­o Hondo	86147130
86	Tintina	86119120
86	Tomás Young	86077060
86	Tramo 16	86035140
86	Tramo 20	86035150
86	Tres Cruces	86091090
86	Urutaú	86056090
86	Vaca Huañuna	86070090
86	Vilelas	86098050
86	Villa Atamisqui	86021030
86	Villa Brana	86119125
86	Villa Figueroa	86070100
86	Villa General Mitre	86007040
86	Villa Giménez	86147140
86	Villa Guasayán	86084030
86	Villa La Punta	86063090
86	Villa Mailín	86028060
86	Villa Matará	86098030
86	Villa Nueva	86175040
86	Villa Ojo de Agua	86126030
86	Villa Quebrachos	86140040
86	Villa Robles	86161048
86	Villa Río Hondo	86147150
86	Villa Rí­o Hondo	86147150
86	Villa Salavina	86168030
86	Villa San Martín (Est. Loreto)	86105010
86	Villa San Martí­n (Est. Loreto)	86105010
86	Villa Silípica	86189050
86	Villa Silí­pica	86189050
86	Villa Unión	86112010
86	Villa Zanjón	86049030
86	Vilmer	86161050
86	Vinara	86147170
86	Vinará	86147170
86	Vuelta de la Barranca	86049120
86	Weisburd	86119130
86	Yanda	86049130
86	Yuchán	86098060
86	Árraga	86189010
90	Acheral	90070010
90	Aguilares	90077010
90	Alderetes	90014010
90	Alpachiri	90021010
90	Alto Verde	90021020
90	Alto de la Cocha	90049001
90	Amaicha del Valle	90098010
90	Amberes	90070015
90	Ampimpa	90098013
90	Arcadia	90021030
90	Atahona	90091010
90	Bajo Grande	90014015
90	Banda del Río Salí	90014020
90	Barrio Aeropuerto	90014020
90	Barrio Araujo	90063020
90	Barrio Malvinas	90098015
90	Barrio Mutual San Martín	90105030
90	Barrio San Felipe	90063010
90	Barrio San Jorge	90007010
90	Barrio San Martín	90007011
90	Barrio Santa Emilia	90021045
90	Barrio Santa Rita	90105045
90	Bella Vista	90056010
90	Benjamín Paz	90112005
90	Boca del Tigre	90007013
90	Boca del Tigre	90014035
90	Campo de Herrera	90028020
90	Capitán Cáceres	90070020
90	Cevil Redondo	90119020
90	Choromoro	90112010
90	Chuscha	90112013
90	Colalao del Valle	90098020
90	Colombres	90014040
90	Colonia 1	90077011
90	Colonia 10	90077014
90	Colonia 14	90077015
90	Colonia 17	90077016
90	Colonia 6	90077013
90	Colonia Mayo - Barrio La Milagrosa	90014050
90	Concepción	90021050
90	Cruce Río Colorado	90056013
90	Delfín Gallo	90014060
90	Domingo Millán	90049003
90	El Bracho	90014070
90	El Cadillal	90105070
90	El Cajón	90007018
90	El Cercado	90070023
90	El Cevilar	90014073
90	El Chañar	90007020
90	El Corralito	90049004
90	El Corte	90014010
90	El Empalme	90014074
90	El Empalme	90014075
90	El Manantial	90063020
90	El Molino	90021053
90	El Mollar	90098030
90	El Naranjito	90014077
90	El Naranjo	90007030
90	El Paraíso	90014060
90	El Polear	90077018
90	El Porvenir	90056016
90	El Puestito	90007033
90	El Rodeo	90007035
90	El Rodeo	90098032
90	El Sacrificio	90049005
90	El Siambón	90105072
90	El Timbó	90007037
90	Esquina	90056018
90	Estación Aráoz	90056020
90	Ex Ingenio Esperanza	90014060
90	Ex Ingenio Los Ralos	90014100
90	Ex Ingenio Luján	90014060
90	Ex Ingenio Nueva Baviera	90028030
90	Ex Ingenio San José	90119030
90	Famaillá	90028030
90	Garmendia	90007040
90	Gastona Norte	90021055
90	Gastona Sud	90021056
90	Gastonilla	90021057
90	Gobernador Piedrabuena	90007070
90	Graneros	90035010
90	Huasa Pampa Norte	90049006
90	Huasa Pampa Sur	90049007
90	Iltico	90021060
90	Ingenio Fronterita	90028040
90	Ingenio La Florida	90014080
90	Ingenio San Pablo	90063030
90	Ingenio Santa Bárbara	90077010
90	Juan Bautista Alberdi	90042010
90	La Angostura	90007043
90	La Cañada	90007045
90	La Cañada	90035017
90	La Cocha	90049010
90	La Costa	90098035
90	La Cruz	90007047
90	La Esperanza	90105075
90	La Florida	90014080
90	La Ramada	90007050
90	La Ramada de Abajo	90007053
90	La Reducción	90063040
90	La Salina	90007055
90	La Tipa	90077019
90	La Trinidad	90021070
90	La Tuquita	90105074
90	Lamadrid	90035020
90	Las Carreras	90098037
90	Las Cejas	90014090
90	Las Piedritas	90014093
90	Las Siringuillas	90098036
90	Las Talas	90056025
90	Las Talitas	90105100
90	Lastenia	90014020
90	Los Aguirre	90063045
90	Los Bulacio	90014095
90	Los Costilla	90070025
90	Los Guchea	90021073
90	Los Gutiérrez	90014010
90	Los Gómez	90056027
90	Los Laureles Sur	90028060
90	Los Nogales	90105030
90	Los Pereyra	90014097
90	Los Pizarros	90049013
90	Los Puestos	90056030
90	Los Ralos	90014100
90	Los Romano	90056032
90	Los Sarmientos	90077020
90	Los Sosa	90070028
90	Los Sueldos	90056034
90	Los Villagra	90014105
90	Los Zazos	90098038
90	Lules	90063050
90	Macomitas	90007060
90	Mancopa	90056038
90	Manuel García Fernández	90056040
90	Manuela Pedraza	90091017
90	Medina	90021080
90	Monte Bello	90077025
90	Monteagudo	90091020
90	Monteros	90070030
90	Nueva Trinidad	90091030
90	Pacará	90014110
90	Padilla	90028070
90	Paso de las Lanzas	90007065
90	Piedrabuena	90007070
90	Pueblo Independencia	90070040
90	Raco	90105078
90	Ranchillos	90014120
90	Rumi Punco	90049016
90	Río Chico	90077030
90	Río Colorado	90056060
90	Río Nío	90007075
90	Río Seco	90070050
90	San Andrés	90014130
90	San Gabriel	90028080
90	San Javier	90105079
90	San José de Buena Vista	90056065
90	San José de La Cocha	90049020
90	San Miguel de Tucumán	90084010
90	San Pedro Mártir	90091037
90	San Pedro de Colalao	90112020
90	San Ramón	90056067
90	Santa Ana	90077040
90	Santa Cruz	90091040
90	Santa Lucía	90070060
90	Santa Rosa de Leales	90056070
90	Sargento Moya	90070070
90	Simoca	90091050
90	Soldado Maldonado	90070080
90	Tacanas	90056075
90	Taco Ralo	90035030
90	Tafí Viejo	90105080
90	Tafí del Valle	90098040
90	Tapia	90112025
90	Taruca Pampa	90007085
90	Teniente Berdina	90070090
90	Timbó Nuevo	90007087
90	Timbó Viejo	90007088
90	Villa Belgrano	90042020
90	Villa Benjamín Aráoz	90007090
90	Villa Burruyacú	90007100
90	Villa Carmela	90119020
90	Villa Chicligasta	90091060
90	Villa Clodomiro Hileret	90077050
90	Villa Fiad - Ingenio Leales	90056080
90	Villa Mariano Moreno - El Colmenar	90105100
90	Villa Nougués	90063080
90	Villa Padre Monti	90007110
90	Villa Quinteros	90070100
90	Villa Recaste	90014100
90	Villa Regina	90056100
90	Villa San Javier	90119025
90	Villa Tercera	90014100
90	Villa de Leales	90056090
90	Villa de Trancas	90112030
90	Vipos	90112040
90	Yerba Buena	90063090
90	Yerba Buena - Marcos Paz	90119030
90	Yánima	90049030
90	Zavalía	90070110
94	Bahía Fox (Is. Malvinas)	94021010
94	Brazo Norte (Is. Malvinas)	94021020
94	Chartres (Is. Malvinas)	94021030
94	Country Club San Justo	94008003
94	Grytviken (Is Georgias del Sur)	94021040
94	Laguna Escondida	94015010
94	Monte Agradable (Is. Malvinas)	94021050
94	Pradera del Ganso (Is. Malvinas)	94021060
94	Puerto Almanza	94015015
94	Puerto Argentino	94021010
94	Puerto Argentino (Is. Malvinas)	94021070
94	Puerto Mitre (Is. Malvinas)	94021080
94	Río Grande	94008010
94	Tolhuin	94011010
94	Ushuaia	94015020`;
