# fiiocontrol-oss

<table>
    <tbody>
        <tr>
            <td><a href="https://fiiocontrol-oss.adithya.zip/" target="_blank">visit web driver</a></td>
        </tr>
    </tbody>
</table>

<img width="1352" height="928" alt="image 53" src="https://github.com/user-attachments/assets/e4ece07c-184f-47c4-9f07-241e35ccc439" />

<br />
<br />


> ⚠️ please use it at your own discretion! its not completely perfect

currently only works with the fiio ja11 since thats the one i have

if you want me to implement controls for another dac, please open an issue or email me@adithya.zip

## contributing new dacs / device drivers

device support is implemented as small "drivers".

- docs: `CONTRIBUTING.md`
- example: `src/libs/devices/fiioJa11.js`

all you need to do is add a new driver file and register it in `src/libs/devices/index.js`.

## why?

i made this cause i dont really like how slowly the official [fiiocontrol](https://fiiocontrol.fiio.com/) loads and how clunky it is. recently i wasnt able to change my eq for a bit cause their website bugged out for a couple weeks. now that it started working again, i didnt want to be in a situation like that again, so i decided to sniff the packets that their web driver sent to the device over web hid and recreated the api. its not the best code but it it almost 99% there with the official driver.

i also made it really easy to import and export your config into a simple json file. the official site requires you to log in and that just adds to the friction. it obviously doesnt have all the auto eq features that fiio has but other than that, i really like how this turned out and i use this primarily whenever i need to adjust my eq ^-^

## acknowledgments

<table>
    <tbody>
        <tr>
            <th>tech</th>
            <td><a href="https://www.solidjs.com" target="_blank">solidjs</a></td>
        </tr>
    </tbody>
</table>
