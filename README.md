# ECU-DefMig
Basic CLI tool for inferring ECU definitions from a known similar rom.

## Description
Let's say you read the rom for your ECU, but it's not listed on
[the known definitions page](http://www.romraider.com/forum/viewtopic.php?f=8&t=3808).
; however, someone has
[shared an experimental ECU definitions file](http://www.romraider.com/forum/viewtopic.php?p=127793&sid=f696b59ec9434f0ea3c310b14eb245a7#p127793)
for an ECU that closely matches yours.

The shared defs file puts names to map and axis storage addresses:
```
<table name="Primary Open Loop Fueling A" storageaddress="114424" sizex="13" sizey="8">
  <table type="X Axis" storageaddress="1143D0" />
  <table type="Y Axis" storageaddress="114404" />
</table>
```

... But if you can get a rom for this known ECU, plug it into
[ScoobyRom](https://github.com/SubaruDieselCrew/ScoobyRom)(SR), and export as a
RomRaider xml file, you'll see that it contains more information about each table:
```
<table type="3D" name="Record 0xBC460" category="Unknown 3D" storagetype="uint8" endian="big" sizex="13" sizey="8" storageaddress="0x114424">
  <!-- min: 0  max: 0.28125  average: 0.09127104 -->
  <scaling units="" expression="x*0.0078125" to_byte="x/0.0078125" format="0.000" fineincrement="0.01" coarseincrement="0.1" />
  <table type="X Axis" name="" storagetype="float" storageaddress="0x1143D0">
    <!-- 0.3 to 1.5 -->
    <scaling units="" expression="x" to_byte="x" format="0.00" fineincrement="1" coarseincrement="5" />
  </table>
  <table type="Y Axis" name="" storagetype="float" storageaddress="0x114404">
    <!-- 1700 to 4000 -->
    <scaling units="" expression="x" to_byte="x" format="0.00" fineincrement="1" coarseincrement="5" />
  </table>
  <description>
  </description>
</table>
```

Doing the same for your rom yields a similar file. ECU-DefMig puts names to the
SR tables by mapping storage addresses with the known defs file and then compares
table attributes, scaling elements, and comments between the mapped SR file and
your unmapped SR file to infer definitions for your unknown ECU rom.

... Or at least, that's the idea, you should probably do a manual 1:1 comparison
in SR between all the inferred tables as a sanity check before writing anything
to your ECU.

## Install Node.js 10+ & Dependencies
 * Linux: `apt-get install -y nodejs` [Debian & Ubuntu](https://nodejs.org/en/download/package-manager/#debian-and-ubuntu-based-linux-distributions)
 * Windows: [Installer](https://nodejs.org/en/download/)
 * MacOS: `brew install node` with [brew](http://brew.sh/)

`npm install`

## Usage
```
$ node ./main.js --help
usage: main.js [-h] [-v] [--source SOURCE] [--source-sr SOURCE_SR]
               [--target TARGET] [--target-sr TARGET_SR]


ECU-DefMig

Optional arguments:
  -h, --help            Show this help message and exit.
  -v, --version         Show program's version number and exit.
  --source SOURCE       Source RomRaider XML definitions
  --source-sr SOURCE_SR
                        Source ScoobyRom RomRaider XML maps
  --target TARGET       Target RomRaider XML definitions to generate
  --target-sr TARGET_SR
                        Target ScoobyRom RomRaider XML maps
```

## Issues
2D tables with only a Y-axis are ignored by ScoobyRom, this tool only exports 3D tables and 2D tables along the X-axis.
